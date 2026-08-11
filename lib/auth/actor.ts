/**
 * Who is acting, and what they may do.
 *
 * Deliberately free of any next-auth import. Session *resolution* lives in
 * `guards.ts`, which pulls in Auth.js and therefore Next's server runtime;
 * keeping the rules here means the service layer — and its tests — never has to
 * load that machinery just to ask "may this person reassign the row?".
 */

import { forbidden } from "@/lib/errors";
import { canAssignOthers, type UserRoleValue } from "@/lib/domain/constants";

export interface ActorUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRoleValue;
  color: string;
  /** Their own theme choice. `null` means "follow the site default". */
  theme: string | null;
}

/**
 * Who the request is acting as, and who is really behind it.
 *
 * `effective` drives every permission decision and everything the UI renders,
 * so an administrator viewing as a regular user genuinely sees that user's
 * application. `real` drives the audit trail, so the record always names the
 * human responsible.
 */
export interface ActorContext {
  effective: ActorUser;
  real: ActorUser;
  isImpersonating: boolean;
}

/**
 * Guards reassigning work to somebody else.
 *
 * Regular users may pick up unassigned work or drop their own, but only
 * managers and administrators may hand work to another person or take it off
 * them.
 */
export function assertCanAssign(
  actor: ActorContext,
  currentAssigneeId: string | null,
  nextAssigneeId: string | null,
): void {
  if (canAssignOthers(actor.effective.role)) return;

  const self = actor.effective.id;
  const claimingUnassigned = currentAssigneeId === null && nextAssigneeId === self;
  const releasingOwn = currentAssigneeId === self && nextAssigneeId === null;

  if (claimingUnassigned || releasingOwn) return;

  throw forbidden(
    "Only managers can assign work to other people. You can claim unassigned work or release your own.",
  );
}

/** Audit fields describing who really acted, and on whose behalf. */
export function auditActor(actor: ActorContext): {
  userId: string;
  impersonatedUserId: string | null;
} {
  return {
    userId: actor.real.id,
    impersonatedUserId: actor.isImpersonating ? actor.effective.id : null,
  };
}
