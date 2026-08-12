/**
 * Authentication (Auth.js v5).
 *
 * Two providers:
 *
 *  - Credentials (email + bcrypt password) — always enabled. This is what makes
 *    the application usable immediately after seeding, with no external
 *    account, SMTP server or OAuth client to set up first.
 *  - Google — enabled only when AUTH_GOOGLE_ID/SECRET are present.
 *
 * Neither provider self-registers. A person can only sign in if an ACTIVE user
 * row already exists for their email; administrators create those in
 * Users / Settings. For an internal tool, open registration would be a hole.
 *
 * Sessions are stateless JWTs, but authorisation is not: `getSessionUser()`
 * re-reads the user row on every request, so deactivating someone takes effect
 * on their next action rather than whenever their token happens to expire.
 *
 * Auth runs on the Node.js runtime, not the edge — Prisma needs it. That is why
 * route protection lives in layouts and route handlers rather than in
 * middleware.
 */

import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
// Imported solely so the `declare module "next-auth/jwt"` augmentation at the
// bottom of this file can resolve the module. Without it TypeScript reports
// TS2664 and the `role` claim goes untyped.
import type { JWT } from "next-auth/jwt";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/db/prisma";
import { signInSchema } from "@/lib/validation/schemas";
import { googleAdmission, resolveAccountForSignIn } from "./account-lookup";

export type SessionRole = "ADMIN" | "MANAGER" | "USER";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: SessionRole;
}

const googleEnabled = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

/**
 * Optional Google Workspace domain restriction, e.g. "jpdgroup.com".
 *
 * Passed to Google as the `hd` hint so the account chooser pre-filters, and —
 * critically — re-checked server-side below. The `hd` parameter is a UX hint
 * that a determined caller can bypass; it is not a security control on its own.
 */
const googleWorkspaceDomain = process.env.AUTH_GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase();

const providers: NextAuthConfig["providers"] = [
  Credentials({
    id: "credentials",
    name: "Email and password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(raw) {
      const parsed = signInSchema.safeParse(raw);
      if (!parsed.success) return null;

      const { email, password } = parsed.data;

      const user = await prisma.user.findUnique({ where: { email } });

      // Compare against a dummy hash when the account is missing or has no
      // password, so a wrong email and a wrong password take the same time and
      // the response cannot be used to enumerate accounts.
      const hash =
        user?.passwordHash ??
        "$2b$12$0000000000000000000000000000000000000000000000000000";
      const passwordMatches = await bcrypt.compare(password, hash);

      if (!user || !user.passwordHash || !passwordMatches) return null;
      if (!user.active) return null;

      return {
        id: user.id,
        email: user.email,
        name: user.displayName,
      };
    },
  }),
];

if (googleEnabled) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          prompt: "select_account",
          // Workspace hint only — the real enforcement is in `signIn` below.
          ...(googleWorkspaceDomain ? { hd: googleWorkspaceDomain } : {}),
        },
      },
    }),
  );
}

export const authConfig: NextAuthConfig = {
  providers,
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
  trustHost: true,
  callbacks: {
    /**
     * Gatekeeper for OAuth. Credentials sign-ins already proved the account
     * exists and is active inside `authorize`; Google sign-ins have not, so
     * they are checked against the user table here.
     */
    async signIn({ user, account, profile }) {
      if (account?.provider !== "google") return true;

      const email = user.email?.toLowerCase();
      const existing = await resolveAccountForSignIn(email);

      const verdict = googleAdmission({
        email,
        emailVerified: (profile as { email_verified?: boolean } | undefined)?.email_verified,
        hostedDomain: (profile as { hd?: string } | undefined)?.hd,
        requiredDomain: googleWorkspaceDomain,
        account: existing,
      });

      if (!verdict.allowed) {
        // From the browser every refusal looks identical — a bounce back to
        // /sign-in — and the causes need completely different fixes. Naming the
        // reason in the server log is what makes this operable.
        console.warn(
          `[auth] Google sign-in refused for ${email ?? "(no email supplied)"}: ${verdict.reason}`,
        );
      }

      return verdict.allowed;
    },

    async jwt({ token, user }) {
      // On initial sign-in, resolve the canonical user row **by email**.
      //
      // Not by `user.id`. For Credentials that field holds this database's own
      // row id, but for an OAuth provider Auth.js fills it from the provider's
      // profile — for Google, the numeric `sub`. Querying a `@db.Uuid` column
      // with that does not merely fail to match, it throws
      // ("Error creating UUID, invalid length"), which takes down the whole
      // sign-in *after* the signIn callback has already approved it. Email is
      // the identity this application keys on, both providers supply it, and
      // `signIn` above has already proved an active row exists for it.
      if (user) {
        const email = user.email?.toLowerCase();
        const record = await resolveAccountForSignIn(email);

        if (record) {
          token.sub = record.id;
          token.email = record.email;
          token.name = record.displayName;
          token.role = record.role;
        } else {
          // Leaving the token half-built would mint a session whose id is the
          // provider's subject — accepted here, then rejected by every guard.
          console.warn(
            `[auth] could not resolve a user row for ${email ?? "(no email)"}; ` +
              "the session would not have been usable.",
          );
          throw new Error("Your account could not be resolved. Contact an administrator.");
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = (token.role as SessionRole | undefined) ?? "USER";
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/** Whether the Google button should render on the sign-in page. */
export const isGoogleAuthEnabled = googleEnabled;

/* -------------------------------------------------------------------------- */
/* Type augmentation                                                          */
/* -------------------------------------------------------------------------- */

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: SessionRole;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: SessionRole;
  }
}

// Keeps the otherwise type-only import above load-bearing for the augmentation.
export type SessionJwt = JWT;
