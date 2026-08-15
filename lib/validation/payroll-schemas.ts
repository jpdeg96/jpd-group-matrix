/**
 * Request schemas for the payroll routes.
 *
 * Kept out of the route files because a Next route module may only export
 * handlers and its own config — exporting a schema from one fails the build
 * with a type error that does not name the real cause.
 */

import { z } from "zod";
import { APPROVAL_STATUSES, PAY_TYPES } from "@/lib/domain/payroll-format";

/**
 * A decimal amount, kept as text.
 *
 * Never parsed to a number on the way in: the point of the whole module is
 * that money does not pass through a float, and `z.number()` here would undo
 * that at the first request.
 */
export const moneyString = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,4})?$/, "Enter an amount like 750.00.");

export const invoicePrefixSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}$/, "Use 2–10 letters or digits, e.g. NAT.");

/** Empty strings from a form field mean "not set", not an invalid value. */
const optionalEmail = z
  .union([z.literal(""), z.string().trim().toLowerCase().email().max(254)])
  .optional()
  .nullable();

const optionalUrl = z
  .union([z.literal(""), z.string().trim().url().max(500)])
  .optional()
  .nullable();

export const contractorSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  clockifyUserId: z.string().trim().max(64).optional().nullable(),
  payType: z.enum(PAY_TYPES as unknown as [string, ...string[]]),
  weeklyAmount: moneyString.optional().nullable(),
  hourlyRate: moneyString.optional().nullable(),
  invoicePrefix: invoicePrefixSchema,
  active: z.boolean().optional(),
  remittanceEmail: optionalEmail,
  discordWebhookUrl: optionalUrl,
  notes: z.string().trim().max(2000).optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
});

export const importSchema = z.object({
  /** Any date inside the week; omit for the week that just finished. */
  periodStart: z.string().optional(),
});

export const approvalPatchSchema = z.object({
  managerStatus: z.enum(APPROVAL_STATUSES as unknown as [string, ...string[]]),
  reviewNote: z.string().max(500).optional().nullable(),
});

export const generateInvoicesSchema = z.object({
  payrollPeriodId: z.string().uuid(),
  /**
   * Only ever set after somebody has been shown which amounts are unusually
   * large and confirmed them. Defaulting it to true would remove the check.
   */
  confirmLargeAmounts: z.boolean().optional(),
});

export const invoiceActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("MARK_PAID"),
    paymentDate: z.string(),
    // Required. "Paid" with no evidence behind it is the audit hole this
    // module exists to close.
    usdtTxHash: z.string().trim().min(1, "Enter the USDT transaction hash.").max(200),
  }),
  z.object({ action: z.literal("MARK_SENT") }),
  z.object({
    action: z.literal("VOID"),
    reason: z.string().trim().min(1, "Give a reason for voiding this invoice.").max(500),
  }),
]);

export const remittanceSchema = z.object({
  payrollPeriodId: z.string().uuid(),
  /**
   * Both default to false on purpose. Mailing an old week, or mailing someone
   * twice, has to be asked for rather than being what happens if a field is
   * left off a request.
   */
  allowOlderPeriod: z.boolean().optional(),
  resend: z.boolean().optional(),
});

export const seedContractorsSchema = z.object({
  people: z
    .array(
      z.object({
        userId: z.string().uuid(),
        payType: z.enum(PAY_TYPES as unknown as [string, ...string[]]),
        weeklyAmount: moneyString.optional().nullable(),
        hourlyRate: moneyString.optional().nullable(),
        invoicePrefix: invoicePrefixSchema.optional(),
      }),
    )
    .min(1, "Pick at least one person."),
});
