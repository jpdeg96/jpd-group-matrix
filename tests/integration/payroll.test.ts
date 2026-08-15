/**
 * Payroll safeguards, against a real database.
 *
 * Most of these assert that Postgres *refuses* something. That is deliberate:
 * the spreadsheet this replaces produced pay periods in 1969 and amounts that
 * were really Unix timestamps, and the fix is not to remember to check — it is
 * that the column will not hold the value.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/db/prisma";
import {
  generateInvoicesForPeriod,
  markInvoicePaid,
  voidInvoice,
} from "@/lib/services/invoices";
import { setApprovalStatus } from "@/lib/services/payroll";
import { listSeedableUsers, seedContractorsFromUsers } from "@/lib/services/contractors";
import { sendRemittanceForPeriod } from "@/lib/services/remittance";
import type { ActorContext } from "@/lib/auth/actor";

const PERIOD_START = new Date("2026-07-05T00:00:00Z"); // Sunday
const PERIOD_END = new Date("2026-07-11T00:00:00Z"); // Saturday
const DEPOSIT = new Date("2026-07-17T00:00:00Z"); // the following Friday

async function makeActor(): Promise<ActorContext> {
  const user = await prisma.user.create({
    data: { email: "manager@jpdgroup.net", displayName: "Manager", role: "MANAGER", color: "#2563eb" },
  });
  const actor = { id: user.id, email: user.email, displayName: user.displayName, role: "MANAGER" as const, color: user.color, theme: null };
  return { effective: actor, real: actor, isImpersonating: false };
}

const period = () =>
  prisma.payrollPeriod.create({
    data: { periodStart: PERIOD_START, periodEnd: PERIOD_END, depositDate: DEPOSIT },
  });

const contractor = (over: Partial<{ name: string; prefix: string; payType: "FLAT_WEEKLY" | "HOURLY" }> = {}) =>
  prisma.contractor.create({
    data: {
      name: over.name ?? "Nathaly",
      invoicePrefix: over.prefix ?? "NAT",
      payType: over.payType ?? "FLAT_WEEKLY",
      weeklyAmount: over.payType === "HOURLY" ? null : new Decimal("750.00"),
      hourlyRate: over.payType === "HOURLY" ? new Decimal("3.13") : null,
    },
  });

beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.weeklyApproval.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.importedTimeEntry.deleteMany();
  await prisma.payrollPeriod.deleteMany();
  await prisma.contractor.deleteMany();
  await prisma.user.deleteMany();
});

describe("what the database refuses", () => {
  it("refuses a pay period that is not Sunday to Saturday", async () => {
    await expect(
      prisma.payrollPeriod.create({
        data: {
          periodStart: new Date("2026-07-06T00:00:00Z"), // Monday
          periodEnd: new Date("2026-07-12T00:00:00Z"),
          depositDate: new Date("2026-07-18T00:00:00Z"),
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a deposit date that is not the following Friday", async () => {
    await expect(
      prisma.payrollPeriod.create({
        data: { periodStart: PERIOD_START, periodEnd: PERIOD_END, depositDate: new Date("2026-07-16T00:00:00Z") },
      }),
    ).rejects.toThrow();
  });

  it("refuses the 1969 pay period the spreadsheet produced", async () => {
    await expect(
      prisma.payrollPeriod.create({
        data: {
          periodStart: new Date("1969-12-28T00:00:00Z"),
          periodEnd: new Date("1970-01-03T00:00:00Z"),
          depositDate: new Date("1970-01-09T00:00:00Z"),
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses a contractor missing the rate their pay type is paid from", async () => {
    await expect(
      prisma.contractor.create({
        data: { name: "Nestor", invoicePrefix: "TOR", payType: "HOURLY", hourlyRate: null },
      }),
    ).rejects.toThrow();
  });

  it("refuses an invoice prefix that would not parse", async () => {
    await expect(
      prisma.contractor.create({
        data: { name: "Bad", invoicePrefix: "n-1", payType: "FLAT_WEEKLY", weeklyAmount: new Decimal("1") },
      }),
    ).rejects.toThrow();
  });

  it("refuses a negative amount", async () => {
    const [p, c] = await Promise.all([period(), contractor()]);
    await expect(
      prisma.weeklyApproval.create({
        data: {
          payrollPeriodId: p.id, contractorId: c.id, payType: "FLAT_WEEKLY",
          weeklyAmount: new Decimal("750"), invoiceAmount: new Decimal("-1"),
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses an approved row with no approver", async () => {
    const [p, c] = await Promise.all([period(), contractor()]);
    await expect(
      prisma.weeklyApproval.create({
        data: {
          payrollPeriodId: p.id, contractorId: c.id, payType: "FLAT_WEEKLY",
          weeklyAmount: new Decimal("750"), invoiceAmount: new Decimal("750"),
          managerStatus: "APPROVED",
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses two time entries with the same Clockify id", async () => {
    const [p, c] = await Promise.all([period(), contractor()]);
    const entry = {
      payrollPeriodId: p.id, contractorId: c.id, clockifyEntryId: "ck-1", clockifyUserId: "u-1",
      startTime: new Date("2026-07-06T09:00:00Z"), endTime: new Date("2026-07-06T17:00:00Z"),
      durationSeconds: 28800,
    };
    await prisma.importedTimeEntry.create({ data: entry });
    await expect(prisma.importedTimeEntry.create({ data: entry })).rejects.toThrow();
  });
});

describe("seeding contractors from users", () => {
  async function makeUsers() {
    // The real four are all linked to Clockify. "Unlinked Person" is a
    // fixture, not a colleague — the unlinked case still needs covering,
    // but naming a real person in it would leave the suite asserting
    // something untrue about them.
    const names: [string, string | null][] = [
      ["Nathaly", "ck-nathaly"],
      ["Nesterly", "ck-nesterly"],
      ["Nestor", "ck-nestor"],
      ["Stephanie", "ck-stephanie"],
      ["Unlinked Person", null],
    ];

    return Promise.all(
      names.map(([displayName, clockifyUserId], index) =>
        prisma.user.create({
          data: {
            email: `${displayName.toLowerCase()}@jpdgroup.net`,
            displayName,
            role: "USER",
            color: ["#2563eb", "#0891b2", "#059669", "#ca8a04"][index]!,
            clockifyUserId,
          },
        }),
      ),
    );
  }

  it("offers every user who is not yet a contractor, with a free prefix each", async () => {
    await makeUsers();
    const seedable = await listSeedableUsers();

    // Alphabetical, so the fixture sorts between Nestor and Stephanie.
    expect(seedable.map((u) => u.displayName)).toEqual([
      "Nathaly",
      "Nesterly",
      "Nestor",
      "Stephanie",
      "Unlinked Person",
    ]);
    // The suggestions must not collide with each other, not just with the
    // database — two people offered together would otherwise clash.
    expect(seedable.map((u) => u.suggestedPrefix)).toEqual([
      "NAT",
      "NES",
      "TOR",
      "STE",
      "UNL",
    ]);
  });

  it("flags who has no Clockify link, since they have no hours to import", async () => {
    await makeUsers();
    const seedable = await listSeedableUsers();
    expect(seedable.find((u) => u.displayName === "Unlinked Person")?.clockifyLinked).toBe(false);
    expect(seedable.find((u) => u.displayName === "Stephanie")?.clockifyLinked).toBe(true);
  });

  it("inherits name, Clockify id and email rather than retyping them", async () => {
    const actor = await makeActor();
    const users = await makeUsers();
    const nathaly = users.find((u) => u.displayName === "Nathaly")!;

    await seedContractorsFromUsers(
      [{ userId: nathaly.id, payType: "FLAT_WEEKLY", weeklyAmount: "750.00" }],
      actor,
    );

    const contractor = await prisma.contractor.findFirstOrThrow({ where: { userId: nathaly.id } });
    expect(contractor.name).toBe("Nathaly");
    expect(contractor.clockifyUserId).toBe("ck-nathaly");
    expect(contractor.remittanceEmail).toBe("nathaly@jpdgroup.net");
    expect(contractor.invoicePrefix).toBe("NAT");
    expect(contractor.weeklyAmount?.toFixed(2)).toBe("750.00");
  });

  it("seeds a whole team in one pass without prefix collisions", async () => {
    const actor = await makeActor();
    const users = await makeUsers();

    const result = await seedContractorsFromUsers(
      users.map((user) => ({
        userId: user.id,
        payType: "HOURLY" as const,
        hourlyRate: "3.13",
      })),
      actor,
    );

    expect(result.created).toHaveLength(5);
    expect(result.skipped).toHaveLength(0);

    const prefixes = (await prisma.contractor.findMany({ select: { invoicePrefix: true } }))
      .map((c) => c.invoicePrefix)
      .sort();
    expect(prefixes).toEqual(["NAT", "NES", "STE", "TOR", "UNL"]);
  });

  it("will not seed the same person twice", async () => {
    const actor = await makeActor();
    const users = await makeUsers();
    const input = { userId: users[0]!.id, payType: "HOURLY" as const, hourlyRate: "3.13" };

    await seedContractorsFromUsers([input], actor);
    const second = await seedContractorsFromUsers([input], actor);

    expect(second.created).toHaveLength(0);
    expect(second.skipped[0]?.reason).toBe("already a contractor");
    expect(await prisma.contractor.count()).toBe(1);
  });

  it("drops a seeded person from the offer list", async () => {
    const actor = await makeActor();
    const users = await makeUsers();
    await seedContractorsFromUsers(
      [{ userId: users[0]!.id, payType: "HOURLY", hourlyRate: "3.13" }],
      actor,
    );

    const seedable = await listSeedableUsers();
    expect(seedable.map((u) => u.displayName)).not.toContain("Nathaly");
  });

  it("refuses an hourly contractor with no rate, in words", async () => {
    const actor = await makeActor();
    const users = await makeUsers();

    const result = await seedContractorsFromUsers(
      [{ userId: users[0]!.id, payType: "HOURLY" }],
      actor,
    );

    expect(result.created).toHaveLength(0);
    expect(result.skipped[0]?.reason).toMatch(/hourly rate/i);
  });
});

describe("invoice generation", () => {
  async function approvedRow(payType: "FLAT_WEEKLY" | "HOURLY" = "FLAT_WEEKLY") {
    const actor = await makeActor();
    const [p, c] = await Promise.all([period(), contractor({ payType })]);

    const row = await prisma.weeklyApproval.create({
      data: {
        payrollPeriodId: p.id,
        contractorId: c.id,
        payType,
        clockifySeconds: payType === "HOURLY" ? 32 * 3600 + 30 * 60 : 28 * 3600,
        weeklyAmount: payType === "HOURLY" ? null : new Decimal("750.00"),
        hourlyRate: payType === "HOURLY" ? new Decimal("3.13") : null,
        invoiceAmount: payType === "HOURLY" ? new Decimal("101.73") : new Decimal("750.00"),
      },
    });

    return { actor, period: p, contractor: c, row };
  }

  it("generates one invoice per approved row, numbered by prefix and week", async () => {
    const { actor, period: p, row } = await approvedRow();
    await setApprovalStatus(row.id, "APPROVED", actor);

    const result = await generateInvoicesForPeriod(p.id, actor);

    expect(result.generated).toHaveLength(1);
    expect(result.generated[0]?.invoiceNumber).toBe("NAT-20260705");
    expect(result.generated[0]?.amount).toBe("750.00");
  });

  it("computes hourly pay the way the brief says", async () => {
    const { actor, period: p, row } = await approvedRow("HOURLY");
    await setApprovalStatus(row.id, "APPROVED", actor);

    const result = await generateInvoicesForPeriod(p.id, actor);
    expect(result.generated[0]?.amount).toBe("101.73");
  });

  it("skips rows nobody has approved", async () => {
    const { actor, period: p } = await approvedRow();
    const result = await generateInvoicesForPeriod(p.id, actor);

    expect(result.generated).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain("not approved");
  });

  it("does not invoice the same week twice", async () => {
    const { actor, period: p, row } = await approvedRow();
    await setApprovalStatus(row.id, "APPROVED", actor);

    const first = await generateInvoicesForPeriod(p.id, actor);
    const second = await generateInvoicesForPeriod(p.id, actor);

    expect(first.generated).toHaveLength(1);
    expect(second.generated).toHaveLength(0);
    expect(second.skipped[0]?.reason).toContain("already invoiced");
    expect(await prisma.invoice.count()).toBe(1);
  });

  it("refuses a duplicate invoice number even written directly", async () => {
    const { actor, period: p, contractor: c, row } = await approvedRow();
    await setApprovalStatus(row.id, "APPROVED", actor);
    await generateInvoicesForPeriod(p.id, actor);

    await expect(
      prisma.invoice.create({
        data: {
          invoiceNumber: "NAT-20260705", contractorId: c.id, payrollPeriodId: p.id,
          payType: "FLAT_WEEKLY", amount: new Decimal("750"), depositDate: DEPOSIT,
        },
      }),
    ).rejects.toThrow();
  });

  it("links the invoice back to its approval row", async () => {
    const { actor, period: p, row } = await approvedRow();
    await setApprovalStatus(row.id, "APPROVED", actor);
    await generateInvoicesForPeriod(p.id, actor);

    const after = await prisma.weeklyApproval.findUnique({ where: { id: row.id } });
    expect(after?.invoiceId).not.toBeNull();
  });
});

describe("approval safeguards", () => {
  it("refuses to change an approval once it has been invoiced", async () => {
    const actor = await makeActor();
    const [p, c] = await Promise.all([period(), contractor()]);
    const row = await prisma.weeklyApproval.create({
      data: {
        payrollPeriodId: p.id, contractorId: c.id, payType: "FLAT_WEEKLY",
        weeklyAmount: new Decimal("750"), invoiceAmount: new Decimal("750"),
      },
    });

    await setApprovalStatus(row.id, "APPROVED", actor);
    await generateInvoicesForPeriod(p.id, actor);

    await expect(setApprovalStatus(row.id, "REJECTED", actor)).rejects.toThrow(
      /void the invoice/i,
    );
  });

  it("survives the approver's account being deleted", async () => {
    // A real bug, caught by the pre-existing suites. The foreign key sets
    // approved_by_id to NULL when a user is deleted; an over-strict check that
    // demanded both approver *and* timestamp on an APPROVED row then rejected
    // it, so deleting anyone who had ever approved payroll failed outright.
    // The week must survive: losing who signed it off is a shame, losing that
    // it *was* signed off would be wrong.
    const actor = await makeActor();
    const [p, c] = await Promise.all([period(), contractor()]);
    const row = await prisma.weeklyApproval.create({
      data: {
        payrollPeriodId: p.id, contractorId: c.id, payType: "FLAT_WEEKLY",
        weeklyAmount: new Decimal("750"), invoiceAmount: new Decimal("750"),
      },
    });
    await setApprovalStatus(row.id, "APPROVED", actor);

    await expect(prisma.user.delete({ where: { id: actor.effective.id } })).resolves.toBeTruthy();

    const after = await prisma.weeklyApproval.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.managerStatus).toBe("APPROVED");
    expect(after.approvedAt).not.toBeNull();
    expect(after.approvedById).toBeNull();
  });

  it("records who approved and when, and clears both on un-approval", async () => {
    const actor = await makeActor();
    const [p, c] = await Promise.all([period(), contractor()]);
    const row = await prisma.weeklyApproval.create({
      data: {
        payrollPeriodId: p.id, contractorId: c.id, payType: "FLAT_WEEKLY",
        weeklyAmount: new Decimal("750"), invoiceAmount: new Decimal("750"),
      },
    });

    const approved = await setApprovalStatus(row.id, "APPROVED", actor);
    expect(approved.approvedById).toBe(actor.effective.id);
    expect(approved.approvedAt).not.toBeNull();

    const rejected = await setApprovalStatus(row.id, "REJECTED", actor, "Hours look wrong");
    expect(rejected.approvedById).toBeNull();
    expect(rejected.approvedAt).toBeNull();
    expect(rejected.reviewNote).toBe("Hours look wrong");
  });
});

describe("remittance safeguards", () => {
  const OLDER_START = new Date("2026-06-28T00:00:00Z"); // Sunday
  const OLDER_END = new Date("2026-07-04T00:00:00Z"); // Saturday
  const OLDER_DEPOSIT = new Date("2026-07-10T00:00:00Z"); // the Friday after

  async function twoPeriods() {
    const actor = await makeActor();
    const older = await prisma.payrollPeriod.create({
      data: { periodStart: OLDER_START, periodEnd: OLDER_END, depositDate: OLDER_DEPOSIT },
    });
    const latest = await period();
    return { actor, older, latest };
  }

  it("refuses to mail anything but the latest period", async () => {
    // The mistake worth making impossible: the spreadsheet this replaces could
    // be pointed at any row, and a mis-click mailed contractors about a week
    // that had already been settled.
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "payroll@jpdgroup.net";

    const { actor, older } = await twoPeriods();

    await expect(sendRemittanceForPeriod(older.id, actor)).rejects.toThrow(
      /not the latest pay period/i,
    );
  });

  it("names the latest period in the refusal, so the fix is obvious", async () => {
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "payroll@jpdgroup.net";

    const { actor, older } = await twoPeriods();

    await expect(sendRemittanceForPeriod(older.id, actor)).rejects.toThrow(/Jul 5, 2026/);
  });

  it("allows an older period when it is explicitly confirmed", async () => {
    // Reissuing a corrected invoice for an earlier week is legitimate; it just
    // has to be asked for. No invoices exist here, so nothing is actually sent.
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "payroll@jpdgroup.net";

    const { actor, older } = await twoPeriods();

    const result = await sendRemittanceForPeriod(older.id, actor, { allowOlderPeriod: true });
    expect(result.sent).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("refuses outright when email is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;

    const { actor, latest } = await twoPeriods();

    await expect(sendRemittanceForPeriod(latest.id, actor)).rejects.toThrow(
      /RESEND_API_KEY/,
    );
  });
});

describe("payment and voiding", () => {
  async function invoiced() {
    const actor = await makeActor();
    const [p, c] = await Promise.all([period(), contractor()]);
    const row = await prisma.weeklyApproval.create({
      data: {
        payrollPeriodId: p.id, contractorId: c.id, payType: "FLAT_WEEKLY",
        weeklyAmount: new Decimal("750"), invoiceAmount: new Decimal("750"),
      },
    });
    await setApprovalStatus(row.id, "APPROVED", actor);
    await generateInvoicesForPeriod(p.id, actor);
    const invoice = await prisma.invoice.findFirstOrThrow();
    return { actor, invoice, period: p, row };
  }

  it("records a USDT payment", async () => {
    const { actor, invoice } = await invoiced();
    const paid = await markInvoicePaid(
      invoice.id,
      { paymentDate: "2026-07-17", usdtTxHash: "0xabc123" },
      actor,
    );

    expect(paid.status).toBe("PAID");
    expect(paid.usdtTxHash).toBe("0xabc123");
    expect(paid.paymentDate?.toISOString().slice(0, 10)).toBe("2026-07-17");
  });

  it("refuses to mark paid without a transaction hash", async () => {
    // The hash is the evidence. "Paid" without it is the hole being closed.
    const { actor, invoice } = await invoiced();
    await expect(
      markInvoicePaid(invoice.id, { paymentDate: "2026-07-17", usdtTxHash: "  " }, actor),
    ).rejects.toThrow(/transaction hash/i);
  });

  it("refuses a paid status written directly with no payment date", async () => {
    const { invoice } = await invoiced();
    await expect(
      prisma.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } }),
    ).rejects.toThrow();
  });

  it("requires a reason to void", async () => {
    const { actor, invoice } = await invoiced();
    await expect(voidInvoice(invoice.id, "   ", actor)).rejects.toThrow(/reason/i);
  });

  it("voids without deleting, and frees the week to be reissued", async () => {
    const { actor, invoice, period: p, row } = await invoiced();

    await voidInvoice(invoice.id, "Wrong rate applied", actor);

    const voided = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(voided.status).toBe("VOID");
    expect(voided.voidReason).toBe("Wrong rate applied");

    // The approval row is released, so the same week can be invoiced again.
    const released = await prisma.weeklyApproval.findUniqueOrThrow({ where: { id: row.id } });
    expect(released.invoiceId).toBeNull();

    const again = await generateInvoicesForPeriod(p.id, actor);
    expect(again.generated).toHaveLength(1);
    // A new number, not the voided one: the void is still a document that
    // existed, and two documents must not share an identifier.
    expect(again.generated[0]?.invoiceNumber).toBe("NAT-20260705-R2");

    // Nothing was lost.
    expect(await prisma.invoice.count()).toBe(2);
  });
});
