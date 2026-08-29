/**
 * Application settings.
 *
 * A single row that every other module reads for the things an administrator
 * controls: the review stage offsets, the weekend rule, the business timezone,
 * presence timeout and marketplace links.
 *
 * Reads are cached in-process for a few seconds. Settings change rarely but are
 * consulted on essentially every request, and without this each page render
 * would issue several identical queries. The window is short enough that a
 * change is visible almost immediately.
 */

import { Decimal } from "@prisma/client/runtime/library";
import { prisma } from "@/lib/db/prisma";
import { todayInTimeZone, type PlainDate } from "@/lib/date/plain-date";
import type { ScheduleConfig } from "@/lib/domain/review-schedule";
import {
  DEFAULT_REVIEW_OFFSETS,
  isTheme,
  normaliseReviewOffsets,
  type ThemeValue,
} from "@/lib/domain/constants";
import { validationError } from "@/lib/errors";
import { recordAudit } from "./audit";
import { normaliseSheetId } from "./google-sheets";

export const SETTINGS_ID = "singleton";

export interface AppSettings {
  siteName: string;
  timeZone: string;
  reviewOffsets: number[];
  weekendAdjustment: boolean;
  presenceTimeoutMinutes: number;
  defaultTheme: ThemeValue;
  clockifyEnabled: boolean;
  clockifyWorkspaceId: string | null;

  /** Payroll identity, printed on invoices and remittance emails. */
  businessName: string;
  businessAddress: string | null;
  invoiceNote: string | null;
  adminRemittanceEmail: string | null;
  remittanceFromName: string;
  remittancePaymentMethod: string;
  remittanceFooterNote: string | null;

  /** Google Drive archiving. The service-account key stays in the environment. */
  driveUploadEnabled: boolean;
  driveFolderId: string | null;

  /** The Google Sheet Bulk import can read. Null when nothing is linked. */
  importSheetId: string | null;
  importSheetTab: string | null;

  /**
   * Phantom Calculator rates, as decimal fractions — 0.2 is 20%.
   *
   * Null means "not set yet", and stays null rather than becoming a number.
   * See `phantomTier1Rate` in the schema: the desktop calculator refuses to
   * produce a purchase price until both are real.
   */
  phantomTier1Rate: number | null;
  phantomStubHubRate: number | null;

  /** Discord notifications. The webhook URL stays in the environment. */
  discordEnabled: boolean;
  /** Newest announcement already posted, so a release is announced once. */
  discordLastReleaseId: string | null;

  /** Last observed Clockify reachability; null until first probed. */
  clockifyHealthy: boolean | null;
}

/**
 * Accepts a pasted Drive folder URL as well as a bare id.
 *
 * Copying the address bar is the obvious thing to do, and rejecting it — or
 * worse, storing it and failing later with "no folder with that ID" — makes
 * this look broken when the person did the sensible thing.
 */
export function normaliseDriveFolderId(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed)
    ? (/\/folders\/([^/?#]+)/.exec(trimmed)?.[1] ?? trimmed)
    : trimmed;
}

const CACHE_TTL_MS = 5_000;

let cached: { value: AppSettings; expiresAt: number } | null = null;

/** Drops the cache so the next read hits the database. */
export function invalidateSettingsCache(): void {
  cached = null;
}

/**
 * The current settings, creating the singleton row on first use so a fresh
 * database is immediately usable without a manual step.
 */
export async function getSettings(): Promise<AppSettings> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const row = await prisma.settings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });

  const value: AppSettings = {
    siteName: row.siteName,
    timeZone: row.timeZone,
    reviewOffsets: normaliseReviewOffsets(
      row.reviewOffsets.length > 0 ? row.reviewOffsets : [...DEFAULT_REVIEW_OFFSETS],
    ),
    weekendAdjustment: row.weekendAdjustment,
    presenceTimeoutMinutes: row.presenceTimeoutMinutes,
    defaultTheme: isTheme(row.defaultTheme) ? row.defaultTheme : "light",
    businessName: row.businessName,
    businessAddress: row.businessAddress,
    invoiceNote: row.invoiceNote,
    adminRemittanceEmail: row.adminRemittanceEmail,
    remittanceFromName: row.remittanceFromName,
    remittancePaymentMethod: row.remittancePaymentMethod,
    remittanceFooterNote: row.remittanceFooterNote,
    clockifyEnabled: row.clockifyEnabled,
    clockifyWorkspaceId: row.clockifyWorkspaceId,
    driveUploadEnabled: row.driveUploadEnabled,
    driveFolderId: row.driveFolderId,
    importSheetId: row.importSheetId,
    importSheetTab: row.importSheetTab,
    // Decimal → number. Safe here in a way it is not for money: a rate is four
    // decimal places of a value below 1, which a double represents exactly
    // enough that the division downstream is unaffected.
    phantomTier1Rate: row.phantomTier1Rate?.toNumber() ?? null,
    phantomStubHubRate: row.phantomStubHubRate?.toNumber() ?? null,
    discordEnabled: row.discordEnabled,
    discordLastReleaseId: row.discordLastReleaseId,
    clockifyHealthy: row.clockifyHealthy,
  };

  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/** The scheduling knobs, in the shape the pure domain functions expect. */
export async function getScheduleConfig(): Promise<ScheduleConfig> {
  const settings = await getSettings();
  return {
    offsets: settings.reviewOffsets,
    weekendAdjustment: settings.weekendAdjustment,
  };
}

/**
 * Today's date in the configured business timezone.
 *
 * Every "what is today?" question routes through here, so changing the zone in
 * Settings changes it everywhere at once — there is no second definition of
 * today anywhere in the codebase.
 */
export async function businessToday(now: Date = new Date()): Promise<PlainDate> {
  const settings = await getSettings();
  return todayInTimeZone(settings.timeZone, now);
}

export interface UpdateSettingsInput {
  siteName?: string;
  timeZone?: string;
  reviewOffsets?: number[];
  weekendAdjustment?: boolean;
  presenceTimeoutMinutes?: number;
  defaultTheme?: ThemeValue;
  clockifyEnabled?: boolean;
  clockifyWorkspaceId?: string | null;

  /** Payroll identity. The Resend credential is not here, by design. */
  businessName?: string;
  businessAddress?: string | null;
  invoiceNote?: string | null;
  adminRemittanceEmail?: string | null;
  remittanceFromName?: string;
  remittancePaymentMethod?: string;
  remittanceFooterNote?: string | null;

  /** Integration switches. Credentials are not here, by design. */
  driveUploadEnabled?: boolean;
  driveFolderId?: string | null;
  discordEnabled?: boolean;
  importSheetId?: string | null;
  importSheetTab?: string | null;

  /** Phantom Calculator rates as decimal fractions. Null clears one. */
  phantomTier1Rate?: number | null;
  phantomStubHubRate?: number | null;
}

/**
 * Validates an IANA timezone by asking Intl to use it.
 *
 * A typo here would silently shift every deadline in the system, so it is
 * rejected outright rather than falling back to a default.
 */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Rejects a Phantom rate that is not a fraction.
 *
 * `null` is allowed and means "not set" — clearing a rate is a legitimate act,
 * and the calculator handles the absence honestly by refusing to calculate.
 */
function assertRateFraction(
  field: "phantomTier1Rate" | "phantomStubHubRate",
  label: string,
  value: number | null | undefined,
): void {
  if (value === undefined || value === null) return;

  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw validationError(`The ${label} rate must be a decimal fraction below 1.`, {
      [field]: [`Enter it as a decimal — 0.20 for 20%, not 20.`],
    });
  }
}

export async function updateSettings(
  input: UpdateSettingsInput,
  actorUserId: string,
): Promise<AppSettings> {
  const existing = await getSettings();

  if (input.timeZone !== undefined && !isValidTimeZone(input.timeZone)) {
    throw validationError(`"${input.timeZone}" is not a recognised IANA timezone.`, {
      timeZone: ["Enter a valid IANA timezone, for example America/Caracas."],
    });
  }

  let offsets: number[] | undefined;
  if (input.reviewOffsets !== undefined) {
    offsets = normaliseReviewOffsets(input.reviewOffsets);
    if (offsets.length === 0) {
      throw validationError("At least one review stage is required.", {
        reviewOffsets: ["Add at least one stage, for example 21, 14, 7, 5, 1."],
      });
    }
  }

  if (
    input.presenceTimeoutMinutes !== undefined &&
    (input.presenceTimeoutMinutes < 1 || input.presenceTimeoutMinutes > 120)
  ) {
    throw validationError("Presence timeout must be between 1 and 120 minutes.", {
      presenceTimeoutMinutes: ["Enter a value between 1 and 120."],
    });
  }

  // The database refuses these too. Checking here as well is what turns a
  // constraint violation into a sentence the administrator can act on, and the
  // mistake being guarded against — typing 20 for 20% — is one somebody will
  // make on their first visit to this card.
  assertRateFraction("phantomTier1Rate", "Tier 1", input.phantomTier1Rate);
  assertRateFraction("phantomStubHubRate", "StubHub", input.phantomStubHubRate);

  await prisma.settings.update({
    where: { id: SETTINGS_ID },
    data: {
      ...(input.siteName !== undefined ? { siteName: input.siteName } : {}),
      ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
      ...(offsets !== undefined ? { reviewOffsets: offsets } : {}),
      ...(input.weekendAdjustment !== undefined
        ? { weekendAdjustment: input.weekendAdjustment }
        : {}),
      ...(input.presenceTimeoutMinutes !== undefined
        ? { presenceTimeoutMinutes: input.presenceTimeoutMinutes }
        : {}),
      ...(input.defaultTheme !== undefined ? { defaultTheme: input.defaultTheme } : {}),
      ...(input.clockifyEnabled !== undefined
        ? { clockifyEnabled: input.clockifyEnabled }
        : {}),
      ...(input.driveUploadEnabled !== undefined
        ? { driveUploadEnabled: input.driveUploadEnabled }
        : {}),
      ...(input.driveFolderId !== undefined
        ? { driveFolderId: normaliseDriveFolderId(input.driveFolderId) }
        : {}),
      ...(input.discordEnabled !== undefined
        ? { discordEnabled: input.discordEnabled }
        : {}),
      // Reduced to the bare id, so pasting the whole URL works.
      ...(input.importSheetId !== undefined
        ? { importSheetId: normaliseSheetId(input.importSheetId) }
        : {}),
      ...(input.importSheetTab !== undefined
        ? { importSheetTab: input.importSheetTab?.trim() || null }
        : {}),
      // Stored through Decimal so the value that lands in Postgres is the one
      // that was typed, at the column's own precision.
      ...(input.phantomTier1Rate !== undefined
        ? {
            phantomTier1Rate:
              input.phantomTier1Rate === null ? null : new Decimal(input.phantomTier1Rate),
          }
        : {}),
      ...(input.phantomStubHubRate !== undefined
        ? {
            phantomStubHubRate:
              input.phantomStubHubRate === null ? null : new Decimal(input.phantomStubHubRate),
          }
        : {}),
      ...(input.businessName !== undefined ? { businessName: input.businessName } : {}),
      ...(input.businessAddress !== undefined
        ? { businessAddress: input.businessAddress || null }
        : {}),
      ...(input.invoiceNote !== undefined ? { invoiceNote: input.invoiceNote || null } : {}),
      ...(input.adminRemittanceEmail !== undefined
        ? { adminRemittanceEmail: input.adminRemittanceEmail || null }
        : {}),
      ...(input.remittanceFromName !== undefined
        ? { remittanceFromName: input.remittanceFromName }
        : {}),
      ...(input.remittancePaymentMethod !== undefined
        ? { remittancePaymentMethod: input.remittancePaymentMethod }
        : {}),
      ...(input.remittanceFooterNote !== undefined
        ? { remittanceFooterNote: input.remittanceFooterNote || null }
        : {}),
      ...(input.clockifyWorkspaceId !== undefined
        ? { clockifyWorkspaceId: input.clockifyWorkspaceId?.trim() || null }
        : {}),
      updatedById: actorUserId,
    },
  });

  invalidateSettingsCache();
  const updated = await getSettings();

  await recordAudit({
    userId: actorUserId,
    entityType: "SETTINGS",
    entityId: "00000000-0000-0000-0000-000000000000",
    action: "UPDATED",
    oldValue: { ...existing },
    newValue: { ...updated },
  });

  return updated;
}

/**
 * Changing the stage offsets does not retroactively rewrite events already in
 * C1 — their stage rows, assignments and completion history stay exactly as
 * they were. The new set applies to events promoted from now on.
 *
 * Rewriting history to match a new configuration would silently invalidate work
 * people had already signed off.
 */
export const OFFSET_CHANGE_IS_NOT_RETROACTIVE = true;
