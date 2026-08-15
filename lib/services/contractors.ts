/**
 * Contractors: the people payroll pays.
 *
 * A contractor is deliberately its own record rather than a set of columns on
 * `User`. Two reasons that matter in practice: payroll history has to outlive
 * an account being deleted, and somebody can be paid without ever logging in.
 *
 * In this business they happen to be the same people, so `userId` links them
 * and the seeding path below is the normal way a contractor gets created —
 * inheriting the name, the Clockify id and the email that are already correct
 * on the user record, rather than asking somebody to retype them.
 */

import { Decimal } from "@prisma/client/runtime/library";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { ActorContext } from "@/lib/auth/actor";
import { auditActor } from "@/lib/auth/actor";
import { recordAudit } from "./audit";
import { conflict, notFound, validationError } from "@/lib/errors";
import { suggestInvoicePrefix, type PayType } from "@/lib/domain/payroll";

export interface ContractorInput {
  name: string;
  clockifyUserId?: string | null;
  payType: PayType;
  weeklyAmount?: string | null;
  hourlyRate?: string | null;
  invoicePrefix: string;
  active?: boolean;
  remittanceEmail?: string | null;
  discordWebhookUrl?: string | null;
  notes?: string | null;
  userId?: string | null;
}

export async function listContractors(options: { includeInactive?: boolean } = {}) {
  return prisma.contractor.findMany({
    where: options.includeInactive ? {} : { active: true },
    include: {
      user: { select: { id: true, displayName: true, email: true, active: true } },
      _count: { select: { invoices: true } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

/** Every prefix already spoken for, so a suggestion cannot collide. */
export async function takenPrefixes(): Promise<string[]> {
  const rows = await prisma.contractor.findMany({ select: { invoicePrefix: true } });
  return rows.map((row) => row.invoicePrefix);
}

/**
 * Users who could become contractors but are not yet.
 *
 * Each carries a suggested prefix, computed against the prefixes already taken
 * *and* against the other suggestions in this same list — otherwise two people
 * offered up together would both be handed the same one.
 */
export async function listSeedableUsers() {
  const [users, existing] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, contractor: { is: null } },
      select: { id: true, displayName: true, email: true, clockifyUserId: true },
      orderBy: { displayName: "asc" },
    }),
    takenPrefixes(),
  ]);

  const taken = new Set(existing);

  return users.map((user) => {
    const suggestedPrefix = suggestInvoicePrefix(user.displayName, taken);
    taken.add(suggestedPrefix);

    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      clockifyUserId: user.clockifyUserId,
      suggestedPrefix,
      /** A user with no Clockify link has no hours to import. */
      clockifyLinked: user.clockifyUserId !== null,
    };
  });
}

function ratesFor(input: ContractorInput): { weeklyAmount: Decimal | null; hourlyRate: Decimal | null } {
  // The database refuses a contractor missing the rate their pay type is paid
  // from; catching it here turns a constraint violation into a sentence.
  if (input.payType === "FLAT_WEEKLY") {
    if (!input.weeklyAmount) {
      throw validationError("A flat-weekly contractor needs a weekly amount.");
    }
    return { weeklyAmount: new Decimal(input.weeklyAmount), hourlyRate: null };
  }

  if (!input.hourlyRate) {
    throw validationError("An hourly contractor needs an hourly rate.");
  }
  return { weeklyAmount: null, hourlyRate: new Decimal(input.hourlyRate) };
}

export async function createContractor(input: ContractorInput, actor: ActorContext) {
  const rates = ratesFor(input);

  try {
    const contractor = await prisma.contractor.create({
      data: {
        name: input.name.trim(),
        clockifyUserId: input.clockifyUserId?.trim() || null,
        payType: input.payType,
        ...rates,
        invoicePrefix: input.invoicePrefix.trim().toUpperCase(),
        active: input.active ?? true,
        remittanceEmail: input.remittanceEmail?.trim().toLowerCase() || null,
        discordWebhookUrl: input.discordWebhookUrl?.trim() || null,
        notes: input.notes?.trim() || null,
        userId: input.userId ?? null,
      },
    });

    await recordAudit({
      ...auditActor(actor),
      entityType: "CONTRACTOR",
      entityId: contractor.id,
      action: "CREATED",
      newValue: {
        name: contractor.name,
        payType: contractor.payType,
        invoicePrefix: contractor.invoicePrefix,
      },
    });

    return contractor;
  } catch (error) {
    throw asFriendlyError(error);
  }
}

export async function updateContractor(
  id: string,
  input: ContractorInput,
  actor: ActorContext,
) {
  const existing = await prisma.contractor.findUnique({ where: { id } });
  if (!existing) throw notFound("That contractor no longer exists.");

  const rates = ratesFor(input);

  try {
    const contractor = await prisma.contractor.update({
      where: { id },
      data: {
        name: input.name.trim(),
        clockifyUserId: input.clockifyUserId?.trim() || null,
        payType: input.payType,
        ...rates,
        invoicePrefix: input.invoicePrefix.trim().toUpperCase(),
        active: input.active ?? existing.active,
        remittanceEmail: input.remittanceEmail?.trim().toLowerCase() || null,
        discordWebhookUrl: input.discordWebhookUrl?.trim() || null,
        notes: input.notes?.trim() || null,
        userId: input.userId ?? null,
      },
    });

    // Rates are recorded because changing one changes what somebody is paid.
    // Weeks already approved keep their snapshot; this is the trail explaining
    // why next week's figure differs.
    await recordAudit({
      ...auditActor(actor),
      entityType: "CONTRACTOR",
      entityId: id,
      action: "UPDATED",
      oldValue: {
        payType: existing.payType,
        weeklyAmount: existing.weeklyAmount?.toFixed(2) ?? null,
        hourlyRate: existing.hourlyRate?.toFixed(4) ?? null,
        active: existing.active,
      },
      newValue: {
        payType: contractor.payType,
        weeklyAmount: contractor.weeklyAmount?.toFixed(2) ?? null,
        hourlyRate: contractor.hourlyRate?.toFixed(4) ?? null,
        active: contractor.active,
      },
    });

    return contractor;
  } catch (error) {
    throw asFriendlyError(error);
  }
}

export interface SeedFromUserInput {
  userId: string;
  payType: PayType;
  weeklyAmount?: string | null;
  hourlyRate?: string | null;
  invoicePrefix?: string;
}

/**
 * Creates contractors from existing user accounts.
 *
 * Name, Clockify id and email come from the user rather than being retyped, so
 * the two cannot drift apart — and a person whose hours already feed the
 * Metrics page is provably the same person payroll pays.
 *
 * Pay type and rate cannot be inherited: nothing on a user record says what
 * somebody earns. They are supplied per person by whoever is doing the setup.
 */
export async function seedContractorsFromUsers(
  inputs: SeedFromUserInput[],
  actor: ActorContext,
): Promise<{ created: string[]; skipped: { name: string; reason: string }[] }> {
  const created: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  const taken = new Set(await takenPrefixes());

  for (const input of inputs) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, displayName: true, email: true, clockifyUserId: true, contractor: { select: { id: true } } },
    });

    if (!user) {
      skipped.push({ name: input.userId, reason: "no such user" });
      continue;
    }
    if (user.contractor) {
      skipped.push({ name: user.displayName, reason: "already a contractor" });
      continue;
    }

    const prefix = (input.invoicePrefix?.trim().toUpperCase() ||
      suggestInvoicePrefix(user.displayName, taken));
    taken.add(prefix);

    try {
      await createContractor(
        {
          name: user.displayName,
          clockifyUserId: user.clockifyUserId,
          payType: input.payType,
          weeklyAmount: input.weeklyAmount,
          hourlyRate: input.hourlyRate,
          invoicePrefix: prefix,
          remittanceEmail: user.email,
          userId: user.id,
        },
        actor,
      );
      created.push(user.displayName);
    } catch (error) {
      skipped.push({
        name: user.displayName,
        reason: error instanceof Error ? error.message : "could not be created",
      });
    }
  }

  return { created, skipped };
}

/**
 * Deactivates rather than deletes.
 *
 * Invoices reference contractors with `Restrict`, so a contractor who has ever
 * been paid cannot be removed — which is correct. Deactivating keeps the
 * history and takes them out of next week's import.
 */
export async function deactivateContractor(id: string, actor: ActorContext) {
  const contractor = await prisma.contractor.findUnique({ where: { id } });
  if (!contractor) throw notFound("That contractor no longer exists.");

  const updated = await prisma.contractor.update({
    where: { id },
    data: { active: false },
  });

  await recordAudit({
    ...auditActor(actor),
    entityType: "CONTRACTOR",
    entityId: id,
    action: "DEACTIVATED",
    oldValue: { active: true },
    newValue: { active: false },
  });

  return updated;
}

/** Turns a constraint violation into something a person can act on. */
function asFriendlyError(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = String(error.meta?.target ?? "");
    if (target.includes("invoice_prefix")) {
      return conflict("That invoice prefix is already used by another contractor.");
    }
    if (target.includes("clockify_user_id")) {
      return conflict("That Clockify user is already linked to another contractor.");
    }
    if (target.includes("user_id")) {
      return conflict("That person is already set up as a contractor.");
    }
    return conflict("A contractor with those details already exists.");
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010") {
    return validationError("Those contractor details were rejected. Check the pay type and rate.");
  }

  return error;
}
