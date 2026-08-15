/**
 * Payroll vocabulary and formatting, safe to import from the browser.
 *
 * Deliberately free of `Decimal`. Prisma's decimal type lives in its Node
 * runtime, and importing it into a client component drags `node:fs` and
 * friends into the browser bundle — the build fails outright. The same reason
 * `actor.ts` exists apart from `guards.ts`.
 *
 * So: money *arithmetic* is server-side in `payroll.ts` and crosses to the
 * browser as an already-rounded string. Everything here is labels and display.
 */

export type PayType = "FLAT_WEEKLY" | "HOURLY";

export const PAY_TYPES: readonly PayType[] = ["FLAT_WEEKLY", "HOURLY"] as const;

export const PAY_TYPE_LABELS: Record<PayType, string> = {
  FLAT_WEEKLY: "Flat weekly",
  HOURLY: "Hourly",
};

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_REVIEW";

export const APPROVAL_STATUSES: readonly ApprovalStatus[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "NEEDS_REVIEW",
] as const;

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  NEEDS_REVIEW: "Needs review",
};

export type InvoiceStatus = "GENERATED" | "SENT" | "PAID" | "VOID";

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "GENERATED",
  "SENT",
  "PAID",
  "VOID",
] as const;

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  GENERATED: "Generated",
  SENT: "Sent",
  PAID: "Paid",
  VOID: "Void",
};

/**
 * Hours for display, from whole seconds.
 *
 * Ordinary floating point is fine here and only here: this figure is read, not
 * paid on. Every amount that becomes money is computed server-side in decimal
 * and arrives already rounded.
 */
export function formatHours(seconds: number): string {
  return (seconds / 3600).toFixed(2);
}

/** `1234.5` → `1,234.50`. Takes the string the server already rounded. */
export function formatMoney(amount: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
