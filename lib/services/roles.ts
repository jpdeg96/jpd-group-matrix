/**
 * Roles and their permissions.
 *
 * The catalogue of permissions lives in code; which role holds which is data.
 * Unknown keys are ignored on read and refused on write, so a row naming a
 * capability nothing enforces can never quietly become a switch that appears to
 * work.
 *
 * ## Locking yourself out
 *
 * The danger with editable permissions is removing your own way back in. Two
 * rules prevent it, both enforced here rather than in the UI:
 *
 *   - At least one role must always hold `users.manage` and `settings.manage`.
 *   - A role cannot be left with nobody able to administer the site.
 *
 * Neither is a warning. A confirmation dialog is no use when the consequence is
 * that nobody can reach the screen the dialog was on.
 */

import { prisma } from "@/lib/db/prisma";
import { conflict, forbidden, notFound, validationError } from "@/lib/errors";
import { auditActor, type ActorContext } from "@/lib/auth/actor";
import {
  isPermission,
  LOCKOUT_CRITICAL,
  PERMISSION_KEYS,
  roleKeyFromName,
  SYSTEM_ROLE_KEYS,
  type Permission,
} from "@/lib/domain/permissions";
import { recordAudit } from "./audit";

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  sortOrder: number;
  permissions: Permission[];
  userCount: number;
}

const roleInclude = {
  permissions: { select: { permission: true } },
  _count: { select: { users: true } },
} as const;

function toView(role: {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  sortOrder: number;
  permissions: { permission: string }[];
  _count: { users: number };
}): RoleView {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    sortOrder: role.sortOrder,
    // Filtered against the catalogue: a stored key the code no longer enforces
    // is history, not a capability, and must not render as a ticked box.
    permissions: role.permissions
      .map((row) => row.permission)
      .filter(isPermission)
      .sort(),
    userCount: role._count.users,
  };
}

export async function listRoles(): Promise<RoleView[]> {
  const roles = await prisma.role.findMany({
    include: roleInclude,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return roles.map(toView);
}

/* -------------------------------------------------------------------------- */
/* Lock-out guard                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Refuses a change that would leave nobody able to administer the site.
 *
 * Takes the *proposed* state of one role and checks the whole set against it,
 * so the question asked is "after this, can anyone still get in?" rather than
 * "does this role look risky on its own".
 */
async function assertSomebodyCanAdminister(
  roleId: string | null,
  proposed: readonly Permission[] | null,
): Promise<void> {
  const roles = await prisma.role.findMany({
    include: { permissions: { select: { permission: true } }, _count: { select: { users: true } } },
  });

  const stillCovered = roles.some((role) => {
    // The role being changed is judged on what it is about to become; a role
    // being deleted (proposed === null) counts for nothing.
    const granted =
      role.id === roleId
        ? (proposed ?? [])
        : role.permissions.map((row) => row.permission);

    const holdsEverything = LOCKOUT_CRITICAL.every((needed) =>
      (granted as readonly string[]).includes(needed),
    );

    // A role nobody holds cannot administer anything, however it is configured.
    return holdsEverything && role._count.users > 0;
  });

  if (!stillCovered) {
    throw conflict(
      "That would leave nobody able to manage users and settings. Give another role — with somebody in it — those permissions first.",
    );
  }
}

function cleanPermissions(input: readonly string[]): Permission[] {
  const unknown = input.filter((key) => !isPermission(key));
  if (unknown.length > 0) {
    throw validationError(
      `Unknown permission${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`,
    );
  }
  return [...new Set(input as readonly Permission[])];
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function setRolePermissions(
  roleId: string,
  permissions: readonly string[],
  actor: ActorContext,
): Promise<RoleView> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: roleInclude,
  });
  if (!role) throw notFound("That role no longer exists.");

  const next = cleanPermissions(permissions);
  const before = toView(role).permissions;

  await assertSomebodyCanAdminister(roleId, next);

  // Replace rather than diff: the set is small, and computing adds and removes
  // by hand is a way to leave a stale row behind.
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId } });
    if (next.length > 0) {
      await tx.rolePermission.createMany({
        data: next.map((permission) => ({ roleId, permission })),
      });
    }
    await tx.role.update({ where: { id: roleId }, data: { updatedAt: new Date() } });
  });

  const added = next.filter((key) => !before.includes(key));
  const removed = before.filter((key) => !next.includes(key));

  await recordAudit({
    ...auditActor(actor),
    entityType: "ROLE",
    entityId: roleId,
    action: "PERMISSIONS_CHANGED",
    oldValue: { permissions: before },
    newValue: { permissions: next, added, removed },
  });

  const updated = await prisma.role.findUniqueOrThrow({
    where: { id: roleId },
    include: roleInclude,
  });
  return toView(updated);
}

export async function createRole(
  input: { name: string; description?: string | null; permissions?: readonly string[] },
  actor: ActorContext,
): Promise<RoleView> {
  const name = input.name.trim();
  if (!name) throw validationError("Give the role a name.");
  if (name.length > 60) throw validationError("Keep the name under 60 characters.");

  const key = roleKeyFromName(name);
  if (!key) {
    throw validationError("That name has no letters or numbers in it to build an id from.");
  }
  if ((SYSTEM_ROLE_KEYS as readonly string[]).includes(key)) {
    throw validationError(`"${name}" collides with a built-in role. Choose another name.`);
  }

  const clash = await prisma.role.findUnique({ where: { key } });
  if (clash) throw conflict(`A role called "${clash.name}" already exists.`);

  const permissions = cleanPermissions(input.permissions ?? []);

  const last = await prisma.role.findFirst({ orderBy: { sortOrder: "desc" } });

  const role = await prisma.role.create({
    data: {
      key,
      name,
      description: input.description?.trim() || null,
      isSystem: false,
      sortOrder: (last?.sortOrder ?? 0) + 1,
      permissions: { create: permissions.map((permission) => ({ permission })) },
    },
    include: roleInclude,
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "ROLE",
    entityId: role.id,
    action: "CREATED",
    newValue: { key, name, permissions },
  });

  return toView(role);
}

export async function updateRole(
  roleId: string,
  input: { name?: string; description?: string | null },
  actor: ActorContext,
): Promise<RoleView> {
  const role = await prisma.role.findUnique({ where: { id: roleId }, include: roleInclude });
  if (!role) throw notFound("That role no longer exists.");

  const data: { name?: string; description?: string | null } = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw validationError("Give the role a name.");
    // The key stays put even when the name changes: audit entries reference it,
    // and renaming an identifier is how history stops joining up.
    data.name = name;
  }
  if (input.description !== undefined) data.description = input.description?.trim() || null;

  if (Object.keys(data).length === 0) return toView(role);

  const updated = await prisma.role.update({
    where: { id: roleId },
    data,
    include: roleInclude,
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "ROLE",
    entityId: roleId,
    action: "UPDATED",
    oldValue: { name: role.name, description: role.description },
    newValue: data,
  });

  return toView(updated);
}

export async function deleteRole(roleId: string, actor: ActorContext): Promise<void> {
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: roleInclude,
  });
  if (!role) throw notFound("That role no longer exists.");

  if (role.isSystem) {
    throw forbidden(
      "The built-in roles cannot be deleted. You can change what they are allowed to do instead.",
    );
  }
  if (role._count.users > 0) {
    throw conflict(
      `${role._count.users} ${role._count.users === 1 ? "person is" : "people are"} in "${role.name}". Move them to another role first.`,
    );
  }

  await assertSomebodyCanAdminister(roleId, null);

  await prisma.role.delete({ where: { id: roleId } });

  await recordAudit({
    ...auditActor(actor),
    entityType: "ROLE",
    entityId: roleId,
    action: "DELETED",
    oldValue: { key: role.key, name: role.name },
  });
}

/**
 * Checked before a user's role is changed.
 *
 * Moving the last administrator out of an administering role locks the site
 * just as thoroughly as unticking the permission, so the same guard applies.
 */
export async function assertRoleChangeIsSafe(
  userId: string,
  nextRoleId: string,
): Promise<void> {
  const [user, nextRole] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { roleId: true, active: true },
    }),
    prisma.role.findUnique({
      where: { id: nextRoleId },
      include: { permissions: { select: { permission: true } } },
    }),
  ]);

  if (!nextRole) throw validationError("That role no longer exists.");
  if (!user || user.roleId === nextRoleId) return;

  const nextHoldsAll = LOCKOUT_CRITICAL.every((needed) =>
    nextRole.permissions.some((row) => row.permission === needed),
  );
  if (nextHoldsAll) return;

  // They are leaving a role that administers; is anybody else left in one?
  const administering = await prisma.role.findMany({
    where: {
      AND: LOCKOUT_CRITICAL.map((permission) => ({ permissions: { some: { permission } } })),
    },
    select: { id: true, users: { where: { active: true }, select: { id: true } } },
  });

  const othersRemain = administering.some((role) =>
    role.users.some((other) => other.id !== userId),
  );

  if (!othersRemain) {
    throw conflict(
      "That is the last person who can manage users and settings. Give somebody else an administering role first.",
    );
  }
}

/** Every permission key, for the editor. */
export const ALL_PERMISSIONS = PERMISSION_KEYS;
