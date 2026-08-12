/**
 * Who a sign-in resolves to, and whether it is allowed.
 *
 * Deliberately free of any `next-auth` import — that package reaches for
 * `next/server`, which cannot be resolved outside a Next build, and which is
 * why `actor.ts` exists too. Keeping these rules here means they can be tested
 * against a real database without booting the auth stack.
 *
 * `lib/auth/index.ts` is then only wiring.
 */

import { prisma } from "@/lib/db/prisma";
import type { UserRoleValue } from "@/lib/domain/constants";

export interface ResolvedAccount {
  id: string;
  email: string;
  displayName: string;
  role: UserRoleValue;
  active: boolean;
}

/**
 * The canonical user row for a sign-in, keyed on **email**.
 *
 * Never on the identifier a provider hands back. For Credentials that happens
 * to be this database's own row id, but for an OAuth provider Auth.js fills
 * `user.id` from the provider's profile — for Google, the numeric `sub`.
 * Querying a `@db.Uuid` column with that does not merely fail to match, it
 * throws ("Error creating UUID, invalid length"), which kills the sign-in after
 * it has already been approved.
 *
 * Email is the identity this application keys on everywhere else — it is what
 * administrators type when creating someone, and what Google sign-in is matched
 * against — so it is the right key here too.
 */
export async function resolveAccountForSignIn(
  email: string | null | undefined,
): Promise<ResolvedAccount | null> {
  const normalised = email?.trim().toLowerCase();
  if (!normalised) return null;

  const user = await prisma.user.findUnique({
    where: { email: normalised },
    select: { id: true, email: true, displayName: true, role: true, active: true },
  });

  return user;
}

export interface GoogleAdmissionInput {
  email: string | null | undefined;
  /** `false` only when Google explicitly says the address is unverified. */
  emailVerified: boolean | undefined;
  /** The `hd` claim on the verified profile, if any. */
  hostedDomain: string | undefined;
  /** AUTH_GOOGLE_WORKSPACE_DOMAIN, when configured. */
  requiredDomain: string | undefined;
  /** The row `resolveAccountForSignIn` found, or null. */
  account: Pick<ResolvedAccount, "active"> | null;
}

export interface GoogleAdmission {
  allowed: boolean;
  /** Why it was refused, for the server log. Null when allowed. */
  reason: string | null;
}

const ALLOWED: GoogleAdmission = { allowed: true, reason: null };

/**
 * Whether a Google profile may sign in.
 *
 * Pure, so every branch is testable. Each refusal carries its own reason: from
 * the browser they are indistinguishable — a bounce back to /sign-in — and the
 * causes need completely different fixes.
 */
export function googleAdmission(input: GoogleAdmissionInput): GoogleAdmission {
  const email = input.email?.trim().toLowerCase();

  if (!email) {
    return { allowed: false, reason: "Google returned no email address" };
  }

  // Without this a Google account could assert an address it does not control.
  if (input.emailVerified === false) {
    return { allowed: false, reason: "Google has not verified this address" };
  }

  if (input.requiredDomain) {
    const required = input.requiredDomain.trim().toLowerCase();
    const hosted = input.hostedDomain?.trim().toLowerCase();
    const fromEmail = email.split("@")[1];

    // The `hd` claim on the *verified profile* is authoritative. The request
    // parameter of the same name is only a hint to the account chooser and a
    // determined caller can bypass it, so it is never trusted here.
    if (hosted !== required && fromEmail !== required) {
      return {
        allowed: false,
        reason:
          `domain "${hosted ?? fromEmail ?? "unknown"}" does not match ` +
          `AUTH_GOOGLE_WORKSPACE_DOMAIN "${required}"`,
      };
    }
  }

  // Sign-in never self-registers: an active account must already exist.
  if (!input.account) {
    return { allowed: false, reason: "no user row with this email — add them under Users first" };
  }

  if (!input.account.active) {
    return { allowed: false, reason: "the account exists but is deactivated" };
  }

  return ALLOWED;
}
