/**
 * Payroll arithmetic and calendar rules.
 *
 * Pure and free of Prisma, so every rule that decides what somebody is paid can
 * be tested without a database.
 *
 * ## Money is never a float
 *
 * The brief's own worked example is the reason. Thirty-two and a half hours at
 * 3.13 is 101.725, and the two obvious JavaScript ways of rounding it disagree:
 * `Math.round(101.725 * 100) / 100` gives 101.73 while `(101.725).toFixed(2)`
 * gives 101.72, because the double nearest 101.725 is fractionally below it.
 * A payroll system cannot be built on a number type where that is true, so
 * every amount here is a `Decimal` and rounding is stated explicitly.
 */

import { Decimal } from "@prisma/client/runtime/library";
import {
  addDays,
  dayOfWeek,
  subtractDays,
  toPlainDate,
  Weekday,
  type PlainDate,
} from "@/lib/date/plain-date";

// Vocabulary is shared with the browser and therefore lives apart from the
// decimal arithmetic; re-exported here so server code has one import.
export {
  APPROVAL_STATUS_LABELS,
  APPROVAL_STATUSES,
  INVOICE_STATUS_LABELS,
  INVOICE_STATUSES,
  PAY_TYPE_LABELS,
  PAY_TYPES,
  formatMoney,
  type ApprovalStatus,
  type InvoiceStatus,
  type PayType,
} from "./payroll-format";

import { PAY_TYPES, type ApprovalStatus, type PayType } from "./payroll-format";

/* -------------------------------------------------------------------------- */
/* The pay week                                                               */
/* -------------------------------------------------------------------------- */

export interface PayPeriod {
  /** Sunday. */
  start: PlainDate;
  /** Saturday. */
  end: PlainDate;
  /** The Friday after `end`. */
  depositDate: PlainDate;
}

/**
 * The pay week containing `date`.
 *
 * Sunday to Saturday. Deliberately computed here rather than reusing the
 * reporting week: they agree today, but payroll boundaries must not silently
 * move because somebody changed how a dashboard buckets its charts.
 */
export function payPeriodContaining(date: PlainDate): PayPeriod {
  // dayOfWeek is ISO-numbered (Monday 1 … Sunday 7), so the modulo maps Sunday
  // to zero and leaves it where it is.
  const start = subtractDays(date, dayOfWeek(date) % 7);
  const end = addDays(start, 6);

  return { start, end, depositDate: depositDateFor(end) };
}

/** The pay week before the one containing `date` — what Monday's import wants. */
export function priorPayPeriod(date: PlainDate): PayPeriod {
  return payPeriodContaining(subtractDays(payPeriodContaining(date).start, 1));
}

/**
 * The Friday after a pay week closes.
 *
 * Saturday plus six days. Written as "the following Friday" rather than "+6"
 * anywhere it is explained, because that is the promise being made to people
 * about when money arrives.
 */
export function depositDateFor(periodEnd: PlainDate): PlainDate {
  return addDays(periodEnd, 6);
}

/** True when `date` is the Sunday that opens a pay week. */
export function isPeriodStart(date: PlainDate): boolean {
  return dayOfWeek(date) === Weekday.Sunday;
}

/* -------------------------------------------------------------------------- */
/* Money                                                                      */
/* -------------------------------------------------------------------------- */

/** Half-up, the convention people expect when they check a payslip by hand. */
export function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Billable hours, from whole seconds, to two decimal places.
 *
 * Two, not four, and the reason is the invoice rather than the arithmetic.
 *
 * 149,371 seconds is 41.491944… hours. Billing the unrounded figure at 3.13
 * gives 129.87, while the 41.49 printed on the invoice gives 129.86 — so the
 * document would not add up in the hand of the person being paid by it, which
 * is the one place arithmetic has to be checkable. Rounding here makes what
 * somebody sees and what they are paid the same number.
 *
 * The cost is at most half a cent per contractor per week, which is a fair
 * price for an invoice nobody has to query.
 *
 * Seconds remain what is stored: summing them cannot drift, where summing
 * rounded hours across a week would.
 */
export function hoursFromSeconds(seconds: number): Decimal {
  return new Decimal(seconds).dividedBy(3600).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Hours as people read them: `32.50`.
 *
 * The decimal route, for server-side use. `payroll-format.ts` has a
 * float-based twin for the browser; a test pins them to the same answers, so
 * the two can never quietly disagree about what a week looked like.
 */
export function formatHours(seconds: number): string {
  return hoursFromSeconds(seconds).toFixed(2);
}

export interface PayInput {
  payType: PayType;
  /** Approved seconds. Ignored for FLAT_WEEKLY. */
  seconds: number;
  weeklyAmount: Decimal | null;
  hourlyRate: Decimal | null;
}

/**
 * What a contractor is owed for one week, rounded to cents.
 *
 * A flat-weekly contractor is paid their weekly amount whatever their hours
 * say. Their time is still imported and shown, because it is what a manager
 * looks at when deciding whether the flat amount is still the right one — but
 * it must never reach the arithmetic.
 */
export function calculatePay(input: PayInput): Decimal {
  if (input.payType === "FLAT_WEEKLY") {
    return roundMoney(input.weeklyAmount ?? new Decimal(0));
  }

  const rate = input.hourlyRate ?? new Decimal(0);
  return roundMoney(hoursFromSeconds(input.seconds).times(rate));
}

/* -------------------------------------------------------------------------- */
/* Invoice numbers                                                            */
/* -------------------------------------------------------------------------- */

const PREFIX_PATTERN = /^[A-Z0-9]{2,10}$/;

export class InvalidInvoicePrefixError extends Error {
  constructor(prefix: string) {
    super(
      `Invalid invoice prefix ${JSON.stringify(prefix)}. ` +
        "Use 2–10 upper-case letters or digits, e.g. NAT.",
    );
    this.name = "InvalidInvoicePrefixError";
  }
}

/**
 * `NAT-20260705` — prefix, then the Sunday the week opened.
 *
 * Keyed to the period start rather than the generation date, so the number
 * identifies a week rather than the day somebody happened to press the button.
 *
 * A reissue after a void takes a `-R2`, `-R3` suffix rather than reusing the
 * original number. An invoice number is an accounting identifier: a voided
 * invoice still exists as a document, and two different documents sharing a
 * number is exactly the ambiguity the number is there to prevent.
 */
export function invoiceNumberFor(
  prefix: string,
  periodStart: PlainDate,
  revision = 1,
): string {
  const normalised = prefix.trim().toUpperCase();
  if (!PREFIX_PATTERN.test(normalised)) throw new InvalidInvoicePrefixError(prefix);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error(`Invoice revision must be a positive integer, got ${revision}.`);
  }

  const base = `${normalised}-${periodStart.replaceAll("-", "")}`;
  return revision === 1 ? base : `${base}-R${revision}`;
}

/** Splits an invoice number back into its parts, or null if it is malformed. */
export function parseInvoiceNumber(
  value: string,
): { prefix: string; periodStart: PlainDate; revision: number } | null {
  const match = /^([A-Z0-9]{2,10})-(\d{4})(\d{2})(\d{2})(?:-R([2-9]|[1-9]\d+))?$/.exec(
    value.trim(),
  );
  if (!match) return null;

  try {
    return {
      prefix: match[1]!,
      periodStart: toPlainDate(`${match[2]}-${match[3]}-${match[4]}`),
      revision: match[5] ? Number(match[5]) : 1,
    };
  } catch {
    return null;
  }
}

/**
 * Suggests an unused invoice prefix for a name.
 *
 * The first three letters, which is what people reach for. When those are
 * taken it tries the *last* three — the rule that turns a second "Nes…" into
 * TOR for Nestor rather than NES2, and the one a human would have picked
 * anyway. Only after both fail does it fall back to numbering.
 *
 * A suggestion, not a decision: the prefix appears on every invoice that
 * person ever issues, so the screen offers this and lets it be overridden.
 */
/**
 * A manual invoice number: `PREFIX-YYYYMMDD-M1`.
 *
 * The `-M` suffix is what keeps a bonus distinguishable from the wage invoice
 * for the same week and from a reissue of it (`-R2`), which matters because all
 * three can legitimately exist for one contractor in one week. The database
 * checks that the suffix and the kind agree, so the number cannot lie about
 * what it is.
 *
 * `sequence` is the count of manual invoices already issued to that contractor
 * for that week, plus one — a second bonus in the same week is `-M2`.
 */
export function manualInvoiceNumberFor(
  prefix: string,
  periodStart: PlainDate,
  sequence: number,
): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Manual invoice sequence must be a positive whole number, got ${sequence}.`);
  }
  const base = invoiceNumberFor(prefix, periodStart);
  return `${base}-M${sequence}`;
}

/**
 * What is wrong with a manual invoice, in the order somebody would fix it.
 *
 * Separate from `validateInvoiceDraft` because the two kinds fail differently:
 * a payroll invoice can legitimately be zero in a week nobody worked, and has
 * no description to be missing. Sharing one validator would have meant one of
 * those rules being weakened for the other's sake.
 */
export function validateManualInvoice(draft: {
  contractorName: string;
  description: string;
  amount: Decimal;
  periodStart: PlainDate;
}): string[] {
  const problems: string[] = [];

  if (draft.contractorName.trim() === "") problems.push("Contractor name is blank.");

  if (draft.description.trim() === "") {
    problems.push("Say what the invoice is for — it is the only record of that.");
  } else if (draft.description.trim().length > 200) {
    problems.push("Description is too long for the invoice line; keep it under 200 characters.");
  }

  if (!draft.amount.isFinite()) problems.push("Amount is not a number.");
  else if (draft.amount.lessThanOrEqualTo(0)) {
    // Unlike a wage, which can be zero for a week nobody worked.
    problems.push("Amount must be more than zero.");
  } else if (draft.amount.greaterThan(AMOUNT_CONFIRMATION_THRESHOLD)) {
    problems.push(
      `Amount ${draft.amount.toFixed(2)} is above the ${AMOUNT_CONFIRMATION_THRESHOLD.toFixed(0)} ` +
        "confirmation threshold.",
    );
  }

  if (draft.periodStart < EARLIEST_PAY_PERIOD || draft.periodStart > LATEST_PAY_PERIOD) {
    problems.push(
      `Pay period ${draft.periodStart} is outside ${EARLIEST_PAY_PERIOD}–${LATEST_PAY_PERIOD}.`,
    );
  }

  return problems;
}

/**
 * The filename an invoice is filed under in Drive: `YYMMDD INV-NUMBER.pdf`.
 *
 * Dated by the deposit date rather than the pay period, so a folder listed
 * alphabetically is also listed by payment run — and so the prefix carries
 * something the invoice number does not, since the number already ends in the
 * period start.
 *
 * Two-digit years sort correctly until 2100 and this is a folder of invoices,
 * not an archive format.
 */
export function driveFileNameFor(invoiceNumber: string, depositDate: PlainDate): string {
  return `${depositDate.slice(2).replaceAll("-", "")} ${invoiceNumber}.pdf`;
}

export function suggestInvoicePrefix(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((value) => value.trim().toUpperCase()));
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (letters.length === 0) {
    let counter = 1;
    while (used.has(`XX${counter}`)) counter += 1;
    return `XX${counter}`;
  }

  const candidates: string[] = [];
  const head = letters.slice(0, 3);
  const tail = letters.slice(-3);

  // Short names cannot make three characters; pad rather than emit something
  // the database will reject for being under the two-character minimum.
  candidates.push(head.length >= 2 ? head : head.padEnd(2, "X"));
  if (tail !== head && tail.length >= 2) candidates.push(tail);

  for (const candidate of candidates) {
    if (!used.has(candidate)) return candidate;
  }

  const base = candidates[0]!;
  for (let counter = 2; counter < 1000; counter += 1) {
    const numbered = `${base}${counter}`;
    if (!used.has(numbered)) return numbered;
  }

  throw new Error(`Could not suggest an invoice prefix for ${JSON.stringify(name)}.`);
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Above this, generating an invoice needs deliberate confirmation.
 *
 * The system this replaces once wrote a Unix timestamp into an amount column.
 * A ceiling does not make that impossible, but it does mean nobody is paid it
 * by accident.
 */
export const AMOUNT_CONFIRMATION_THRESHOLD = new Decimal(100_000);

export const EARLIEST_PAY_PERIOD: PlainDate = toPlainDate("2024-01-01");
export const LATEST_PAY_PERIOD: PlainDate = toPlainDate("2099-12-31");

export interface InvoiceDraft {
  invoiceNumber: string;
  contractorName: string;
  periodStart: PlainDate;
  periodEnd: PlainDate;
  payType: PayType;
  amount: Decimal;
}

/**
 * Everything wrong with a draft invoice, rather than the first thing.
 *
 * Returning the full list matters: these are checked in bulk before a run, and
 * fixing one problem at a time across twenty rows is how people give up and go
 * back to the spreadsheet.
 */
export function validateInvoiceDraft(draft: InvoiceDraft): string[] {
  const problems: string[] = [];

  if (draft.invoiceNumber.trim() === "") problems.push("Invoice number is blank.");
  else if (!parseInvoiceNumber(draft.invoiceNumber)) {
    problems.push(`Invoice number ${JSON.stringify(draft.invoiceNumber)} is malformed.`);
  }

  if (draft.contractorName.trim() === "") problems.push("Contractor name is blank.");

  if (draft.periodStart > draft.periodEnd) {
    problems.push("Pay period starts after it ends.");
  }
  if (draft.periodStart < EARLIEST_PAY_PERIOD || draft.periodStart > LATEST_PAY_PERIOD) {
    problems.push(
      `Pay period ${draft.periodStart} is outside ${EARLIEST_PAY_PERIOD}–${LATEST_PAY_PERIOD}.`,
    );
  }

  if (!PAY_TYPES.includes(draft.payType)) {
    problems.push(`Unknown pay type ${JSON.stringify(draft.payType)}.`);
  }

  if (!draft.amount.isFinite()) problems.push("Amount is not a number.");
  else if (draft.amount.isNegative()) problems.push("Amount is negative.");
  else if (draft.amount.greaterThan(AMOUNT_CONFIRMATION_THRESHOLD)) {
    problems.push(
      `Amount ${draft.amount.toFixed(2)} is above the ${AMOUNT_CONFIRMATION_THRESHOLD.toFixed(0)} ` +
        "confirmation threshold.",
    );
  }

  return problems;
}

/** Only an approved, not-yet-invoiced row may become an invoice. */
export function canGenerateInvoice(row: {
  managerStatus: ApprovalStatus;
  invoiceId: string | null;
}): boolean {
  return row.managerStatus === "APPROVED" && row.invoiceId === null;
}

/**
 * Whether a re-import may overwrite an approval row's hours.
 *
 * Re-importing a week is routine — a timer gets corrected, someone forgets to
 * stop one. Silently restating a week a manager has already signed off, or one
 * that has already been invoiced, is not.
 */
export function canRefreshFromImport(row: {
  managerStatus: ApprovalStatus;
  invoiceId: string | null;
}): boolean {
  if (row.invoiceId !== null) return false;
  return row.managerStatus === "PENDING" || row.managerStatus === "NEEDS_REVIEW";
}
