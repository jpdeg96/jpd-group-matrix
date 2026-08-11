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
      if (!email) return false;

      // Google must have verified the address. Without this check a Google
      // account could assert an address it does not control.
      if (profile && profile.email_verified === false) return false;

      // Server-side Workspace enforcement. The `hd` claim on the verified
      // profile is authoritative; the request parameter of the same name is not.
      if (googleWorkspaceDomain) {
        const hostedDomain = (profile as { hd?: string } | undefined)?.hd
          ?.toLowerCase();
        const emailDomain = email.split("@")[1];

        if (
          hostedDomain !== googleWorkspaceDomain &&
          emailDomain !== googleWorkspaceDomain
        ) {
          return false;
        }
      }

      // Sign-in never self-registers: an active account must already exist.
      const existing = await prisma.user.findUnique({ where: { email } });
      return Boolean(existing?.active);
    },

    async jwt({ token, user }) {
      // On initial sign-in resolve the canonical user row; `user.id` is absent
      // for Google, so fall back to matching on email.
      if (user) {
        const email = user.email?.toLowerCase();
        const record = user.id
          ? await prisma.user.findUnique({ where: { id: user.id } })
          : email
            ? await prisma.user.findUnique({ where: { email } })
            : null;

        if (record) {
          token.sub = record.id;
          token.email = record.email;
          token.name = record.displayName;
          token.role = record.role;
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
