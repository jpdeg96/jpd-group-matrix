/**
 * Sign-in resolution and Google admission, against a real database.
 *
 * These live in the integration suite because `resolveAccountForSignIn` queries
 * Prisma — and the bug they exist to prevent was one no mocked-database test
 * could have caught, because the failure was Postgres rejecting the *shape* of
 * the value being looked up.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  googleAdmission,
  resolveAccountForSignIn,
  type ResolvedAccount,
} from "@/lib/auth/account-lookup";
import { prisma } from "@/lib/db/prisma";

/**
 * What Google puts in `sub`: a 21-digit decimal string. Auth.js copies it into
 * `user.id` for OAuth sign-ins, where Credentials would have put this
 * database's own uuid.
 */
const GOOGLE_SUB = "118234567890123456789";

async function makeUser(
  over: Partial<{ email: string; active: boolean; role: "ADMIN" | "MANAGER" | "USER" }> = {},
) {
  return prisma.user.create({
    data: {
      email: over.email ?? "person@jpdgroup.net",
      displayName: "Test Person",
      role: over.role ?? "MANAGER",
      active: over.active ?? true,
      color: "#2563eb",
    },
  });
}

const admit = (over: Partial<Parameters<typeof googleAdmission>[0]> = {}) =>
  googleAdmission({
    email: "person@jpdgroup.net",
    emailVerified: true,
    hostedDomain: undefined,
    requiredDomain: undefined,
    account: { active: true },
    ...over,
  });

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
});

describe("resolveAccountForSignIn", () => {
  it("resolves a Google sign-in, whose provider id is not a key in this database", async () => {
    // THE REGRESSION. Resolution used to key on `user.id`, which for Google is
    // the numeric `sub`. Against a uuid column that does not miss — it throws
    // "Error creating UUID, invalid length", killing every Google sign-in
    // *after* the signIn callback had already approved it.
    const row = await makeUser({ role: "ADMIN" });

    // Proves the old approach was fatal rather than merely wrong.
    await expect(prisma.user.findUnique({ where: { id: GOOGLE_SUB } })).rejects.toThrow();

    const resolved = await resolveAccountForSignIn("person@jpdgroup.net");
    expect(resolved?.id).toBe(row.id);
    expect(resolved?.role).toBe("ADMIN");
  });

  it("matches case-insensitively and ignores surrounding space", async () => {
    const row = await makeUser();
    expect((await resolveAccountForSignIn("  Person@JPDGroup.NET "))?.id).toBe(row.id);
  });

  it("carries the database role, never anything a provider asserted", async () => {
    await makeUser({ role: "USER" });
    expect((await resolveAccountForSignIn("person@jpdgroup.net"))?.role).toBe("USER");
  });

  it("returns a deactivated account rather than hiding it", async () => {
    // Admission decides what to do about it; the lookup only reports.
    await makeUser({ active: false });
    expect((await resolveAccountForSignIn("person@jpdgroup.net"))?.active).toBe(false);
  });

  it("returns null for an unknown address, and for no address at all", async () => {
    expect(await resolveAccountForSignIn("stranger@example.com")).toBeNull();
    expect(await resolveAccountForSignIn(null)).toBeNull();
    expect(await resolveAccountForSignIn("")).toBeNull();
    expect(await resolveAccountForSignIn(undefined)).toBeNull();
  });
});

describe("googleAdmission", () => {
  it("admits an active account with a verified address", () => {
    expect(admit()).toEqual({ allowed: true, reason: null });
  });

  it("refuses an address with no user row — sign-in never self-registers", () => {
    const verdict = admit({ account: null });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("no user row");
  });

  it("refuses a deactivated account", () => {
    const verdict = admit({ account: { active: false } });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("deactivated");
  });

  it("refuses an address Google has not verified", () => {
    const verdict = admit({ emailVerified: false });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("not verified");
  });

  it("treats an absent email_verified claim as acceptable", () => {
    // Only an explicit `false` is a refusal; Google omits the claim in some
    // profile shapes and treating that as unverified locks everyone out.
    expect(admit({ emailVerified: undefined }).allowed).toBe(true);
  });

  it("refuses an email with no address at all", () => {
    expect(admit({ email: null }).allowed).toBe(false);
  });

  describe("workspace domain restriction", () => {
    it("admits when the verified hd claim matches", () => {
      expect(
        admit({ requiredDomain: "jpdgroup.net", hostedDomain: "jpdgroup.net" }).allowed,
      ).toBe(true);
    });

    it("admits on the email domain when hd is absent", () => {
      expect(
        admit({ requiredDomain: "jpdgroup.net", hostedDomain: undefined }).allowed,
      ).toBe(true);
    });

    it("refuses a personal account against a Workspace domain", () => {
      const verdict = admit({
        email: "someone@gmail.com",
        requiredDomain: "jpdgroup.net",
        hostedDomain: undefined,
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toContain("gmail.com");
      expect(verdict.reason).toContain("jpdgroup.net");
    });

    it("refuses a near-miss domain", () => {
      // The exact configuration mistake worth catching: .com vs .net.
      expect(
        admit({ requiredDomain: "jpdgroup.com", hostedDomain: "jpdgroup.net" }).allowed,
      ).toBe(false);
    });

    it("compares case-insensitively", () => {
      expect(
        admit({ requiredDomain: "JPDGroup.NET", hostedDomain: "jpdgroup.net" }).allowed,
      ).toBe(true);
    });

    it("ignores the domain check entirely when none is configured", () => {
      expect(admit({ email: "anyone@anywhere.com", requiredDomain: undefined }).allowed).toBe(
        true,
      );
    });
  });

  it("checks the domain before the user row, so the log names the real cause", () => {
    // A wrong AUTH_GOOGLE_WORKSPACE_DOMAIN would otherwise be reported as
    // "no user row", sending you to add accounts that already exist.
    const verdict = admit({
      email: "someone@gmail.com",
      requiredDomain: "jpdgroup.net",
      account: null,
    });
    expect(verdict.reason).toContain("does not match");
  });
});

describe("the two together", () => {
  it("admits a real person signing in with Google", async () => {
    await makeUser({ email: "real@jpdgroup.net", role: "ADMIN" });
    const account: ResolvedAccount | null = await resolveAccountForSignIn("real@jpdgroup.net");

    expect(
      googleAdmission({
        email: "real@jpdgroup.net",
        emailVerified: true,
        hostedDomain: "jpdgroup.net",
        requiredDomain: "jpdgroup.net",
        account,
      }),
    ).toEqual({ allowed: true, reason: null });
  });

  it("refuses someone who has never been added", async () => {
    const account = await resolveAccountForSignIn("newhire@jpdgroup.net");
    const verdict = googleAdmission({
      email: "newhire@jpdgroup.net",
      emailVerified: true,
      hostedDomain: "jpdgroup.net",
      requiredDomain: "jpdgroup.net",
      account,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("no user row");
  });
});
