/**
 * Session resolution and role gates.
 *
 * This module pulls in Auth.js and therefore Next's server runtime. The
 * permission *rules* deliberately live in `actor.ts`, which has no such
 * dependency, so services can be tested without booting the auth stack.
 *
 * Permission model:
 *
 *   ADMIN   — everything: users, settings, event types, impersonation.
 *   MANAGER — everything operational, plus assigning work to other people.
 *   USER    — operational work; may claim unassigned work or release their own.
 *
 * Impersonation ("view as") is layered on top. The target user id lives in an
 * httpOnly cookie, but that cookie is worthless on its own: it is only honoured
 * when the *real* session belongs to an active administrator, re-checked on
 * every request. Forging it gets you nothing.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, type SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import {
  isPermission,
  PERMISSIONS,
  type Permission,
} from "@/lib/domain/permissions";
import { forbidden, unauthenticated } from "@/lib/errors";
import { roleLabel, type UserRoleValue } from "@/lib/domain/constants";
import type { ActorContext, ActorUser } from "./actor";

export { assertCanAssign, auditActor } from "./actor";
export type { ActorContext, ActorUser } from "./actor";

export const IMPERSONATION_COOKIE = "jpd_view_as";

const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  color: true,
  theme: true,
  active: true,
  // The role and its grants come back with the user, so resolving what somebody
  // may do costs no extra round trip and `can()` can stay synchronous.
  roleRef: {
    select: {
      key: true,
      name: true,
      permissions: { select: { permission: true } },
    },
  },
} as const;

async function loadActor(id: string): Promise<ActorUser | null> {
  const user = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!user || !user.active) return null;

  /*
   * A user with no role row grants nothing.
   *
   * That state should not exist — the migration backfilled every row and the
   * column is a restricted foreign key — but if it ever does, the safe reading
   * of "no role" is "no elevated permission", not a crash and not a free pass.
   */
  const granted = (user.roleRef?.permissions ?? [])
    .map((row) => row.permission)
    .filter(isPermission);

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.roleRef?.key ?? user.role,
    roleName: user.roleRef?.name ?? roleLabel(user.role),
    permissions: new Set(granted),
    color: user.color,
    theme: user.theme,
  };
}

/**
 * The signed-in user, re-read from the database.
 *
 * The session JWT is only a claim of identity. Role and active status come from
 * the current row, so a demotion or deactivation applies on the very next
 * request rather than lingering until the token expires.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const user = await loadActor(id);
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

/** The full acting context, resolving impersonation if it is active and valid. */
export async function getActorContext(): Promise<ActorContext | null> {
  const session = await auth();
  const realId = session?.user?.id;
  if (!realId) return null;

  const real = await loadActor(realId);
  if (!real) return null;

  const store = await cookies();
  const targetId = store.get(IMPERSONATION_COOKIE)?.value;

  // Honoured only for somebody who may impersonate, and measured on the *real*
  // account — resolving the cookie against the effective one would let a
  // borrowed session extend itself. This single check is what makes the whole
  // mechanism safe.
  const mayImpersonate = real.permissions.has("impersonate");
  if (!targetId || !mayImpersonate || targetId === real.id) {
    return { effective: real, real, isImpersonating: false };
  }

  const target = await loadActor(targetId);
  if (!target) {
    // Stale cookie — the target was deleted or deactivated. Fall back to the
    // administrator rather than failing the request.
    return { effective: real, real, isImpersonating: false };
  }

  return { effective: target, real, isImpersonating: true };
}

export async function requireActor(): Promise<ActorContext> {
  const actor = await getActorContext();
  if (!actor) throw unauthenticated();
  return actor;
}

/**
 * Requires a named capability, measured against the *effective* user.
 *
 * This replaced a rank check — "is this person senior enough?" — which could
 * not express a role that does most of a manager's job but not payroll. Every
 * route now names the one thing it needs, which is also what makes the
 * permission editor honest: unticking a box here genuinely closes that route.
 */
export async function requirePermission(
  permission: Permission,
): Promise<ActorContext> {
  const actor = await requireActor();

  if (!actor.effective.permissions.has(permission)) {
    const entry = PERMISSIONS.find((item) => item.key === permission);
    throw forbidden(
      `You do not have permission to ${(entry?.label ?? permission).toLowerCase()}.`,
    );
  }

  return actor;
}

export const requireUser = requireActor;

/**
 * The page-component counterpart to `requireActor`: it redirects instead of
 * throwing.
 *
 * The distinction is not stylistic. A route handler must throw, so the error
 * handler can answer 401. A page must not: layouts and pages render
 * *concurrently* in the App Router, so the authenticated shell's own
 * `redirect("/sign-in")` does not stop a page body from running underneath it.
 * A page that throws therefore turns an ordinary signed-out visit — an expired
 * session, a bookmarked URL — into a 500.
 */
export async function requirePageActor(): Promise<ActorContext> {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");
  return actor;
}

/**
 * Administrator check against the *real* account, ignoring impersonation.
 *
 * Used for the impersonation controls themselves — otherwise an administrator
 * who had viewed-as a regular user would lose the ability to switch back.
 */
export async function requireRealAdmin(): Promise<ActorContext> {
  const actor = await requireActor();
  if (!actor.real.permissions.has("impersonate")) {
    throw forbidden("You do not have permission to view the site as another user.");
  }
  return actor;
}
