/**
 * Creates (or repairs) an administrator account.
 *
 *   npm run create-admin
 *
 * This is the production bootstrap: `db:seed` builds demo users with a shared
 * password taken from an environment variable, which is fine for development
 * and wrong for a real deployment. This script is the way to get the first real
 * person into a fresh database.
 *
 * NON-DESTRUCTIVE. It touches exactly one user row and nothing else — no
 * events, no stages, no notes. Safe to run against a live database.
 *
 * If the email already exists it will, on confirmation, reset that account's
 * password and promote it to an active administrator. That doubles as the
 * recovery path for a locked-out admin.
 *
 * Values may also come from the environment, for a non-interactive run:
 *
 *   ADMIN_EMAIL=me@example.com ADMIN_NAME="Jane Doe" ADMIN_PASSWORD=... \
 *     npm run create-admin -- --yes
 *
 * Passing the password this way puts it in your shell history and process list;
 * prefer the interactive prompt unless you are scripting.
 */

import "dotenv/config";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { prisma } from "../lib/db/prisma";
import { recordAudit } from "../lib/services/audit";
import { USER_COLOR_PALETTE } from "../lib/domain/constants";

/** Matches the cost factor used everywhere else, so hashes are consistent. */
const BCRYPT_ROUNDS = 12;

const MIN_PASSWORD_LENGTH = 10;

const assumeYes = process.argv.includes("--yes") || process.argv.includes("-y");

/**
 * Readline over a proxy stream whose writes can be suppressed, so a typed
 * password never reaches the terminal or a scrollback buffer.
 */
let muted = false;

const output = new Writable({
  write(chunk, _encoding, callback) {
    if (!muted) process.stdout.write(chunk);
    callback();
  },
});

const rl = createInterface({ input: process.stdin, output, terminal: true });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  muted = true;
  try {
    const answer = await ask("");
    return answer;
  } finally {
    muted = false;
    process.stdout.write("\n");
  }
}

async function askRequired(
  question: string,
  envValue: string | undefined,
  validate: (value: string) => string | null,
): Promise<string> {
  if (envValue !== undefined) {
    const problem = validate(envValue);
    if (problem) throw new Error(problem);
    return envValue;
  }

  for (;;) {
    const answer = (await ask(question)).trim();
    const problem = validate(answer);
    if (!problem) return answer;
    console.log(`  ${problem}`);
  }
}

function validateEmail(value: string): string | null {
  if (value.length === 0) return "Email is required.";
  if (value.length > 254) return "Email is too long.";
  // Deliberately permissive. The database has the final say via its
  // lowercase CHECK constraint; this only catches obvious typos.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "That does not look like an email address.";
  return null;
}

function validateName(value: string): string | null {
  if (value.length === 0) return "Name is required.";
  if (value.length > 120) return "Name must be 120 characters or fewer.";
  return null;
}

function validatePassword(value: string): string | null {
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (value.length > 200) return "Password must be 200 characters or fewer.";
  return null;
}

/** Picks the least-used palette color, matching how the Users page assigns them. */
async function suggestColor(): Promise<string> {
  const used = await prisma.user.findMany({ select: { color: true } });
  const counts = new Map<string, number>(USER_COLOR_PALETTE.map((color) => [color, 0]));

  for (const { color } of used) {
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  let best: string = USER_COLOR_PALETTE[0]!;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const color of USER_COLOR_PALETTE) {
    const count = counts.get(color) ?? 0;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

async function main() {
  const target = process.env.DATABASE_URL ?? "(DATABASE_URL is not set)";
  // Show which database is about to be written to, with the credentials
  // stripped — running this against the wrong database is the easy mistake.
  console.log(`\nDatabase: ${target.replace(/\/\/[^@]*@/, "//***@")}\n`);

  const email = (
    await askRequired("Email:    ", process.env.ADMIN_EMAIL, validateEmail)
  )
    .trim()
    .toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, displayName: true, role: true, active: true },
  });

  if (existing && !assumeYes) {
    console.log(
      `\n  That email already exists: ${existing.displayName} (${existing.role}` +
        `${existing.active ? "" : ", deactivated"}).`,
    );
    const confirm = (
      await ask("  Reset its password and make it an active admin? [y/N] ")
    )
      .trim()
      .toLowerCase();
    if (confirm !== "y" && confirm !== "yes") {
      console.log("\nNothing changed.\n");
      return;
    }
  }

  const displayName = await askRequired(
    "Name:     ",
    process.env.ADMIN_NAME ?? existing?.displayName,
    validateName,
  );

  let password: string;
  if (process.env.ADMIN_PASSWORD !== undefined) {
    const problem = validatePassword(process.env.ADMIN_PASSWORD);
    if (problem) throw new Error(problem);
    password = process.env.ADMIN_PASSWORD;
  } else {
    for (;;) {
      const first = await askHidden(`Password: `);
      const problem = validatePassword(first);
      if (problem) {
        console.log(`  ${problem}`);
        continue;
      }
      const second = await askHidden("Confirm:  ");
      if (first !== second) {
        console.log("  Passwords did not match.");
        continue;
      }
      password = first;
      break;
    }
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { displayName, passwordHash, role: "ADMIN", active: true },
        select: { id: true, email: true, displayName: true, role: true, color: true },
      })
    : await prisma.user.create({
        data: {
          email,
          displayName,
          passwordHash,
          role: "ADMIN",
          active: true,
          color: await suggestColor(),
        },
        select: { id: true, email: true, displayName: true, role: true, color: true },
      });

  // Attributed to the account itself: there is no prior actor to credit when
  // bootstrapping, and leaving the trail empty would hide how the first
  // administrator came to exist.
  await recordAudit({
    userId: user.id,
    entityType: "USER",
    entityId: user.id,
    action: existing ? "PASSWORD_CHANGED" : "CREATED",
    newValue: {
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      source: "create-admin script",
    },
  });

  console.log(
    `\n${existing ? "Updated" : "Created"} administrator ${user.displayName} <${user.email}>\n` +
      `Sign in at your deployment's /sign-in.\n`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
