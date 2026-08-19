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
 * Guards changing who a piece of work belongs to.
 *
 * A regular user may do exactly one thing: claim work that nobody has taken.
 * They cannot hand it to somebody else, take it off somebody else, or put it
 * back once they have claimed it.
 *
 * Releasing your own used to be allowed and is not any more. Claiming a row is
 * a statement to the rest of the team that it is being dealt with, and being
 * able to quietly withdraw that leaves the work looking untouched while
 * everyone who saw the claim has moved on to something else. Handing it back is
 * a decision for whoever is coordinating, so it goes through a manager.
 */
export function assertCanAssign(
  actor: ActorContext,
  currentAssigneeId: string | null,
  nextAssigneeId: string | null,
): void {
  if (canAssignOthers(actor.effective.role)) return;

  const self = actor.effective.id;

  if (currentAssigneeId === null && nextAssigneeId === self) return;

  throw forbidden(
    currentAssigneeId === self && nextAssigneeId === null
      ? "You cannot unassign yourself. Ask a manager to reassign it if you cannot take it on."
      : "You can only claim work nobody has taken. Only managers can assign it to somebody else.",
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
