/** Domain constants and vocabulary. Single source of truth for both. */

/**
 * Default review stage offsets, furthest-out first.
 *
 * This is only the factory default — the live set lives in Settings and is
 * administrator-configurable, so nothing outside Settings should import this
 * except as a fallback.
 */
export const DEFAULT_REVIEW_OFFSETS = [21, 14, 7, 5, 1] as const;

/** Sanity bound, matching the database CHECK constraint. */
export const MAX_REVIEW_OFFSET_DAYS = 365;

/**
 * The display label for a stage, derived from its stored offset.
 *
 * Derived from `offset_days` and never from `review_due`: weekend adjustment
 * can legitimately collapse two stages onto the same due date, so the due date
 * does not identify a stage.
 */
export function reviewStageLabel(offsetDays: number): string {
  return `D-${offsetDays}`;
}

/** Normalises a user-supplied offset list: integers, in range, unique, descending. */
export function normaliseReviewOffsets(values: readonly number[]): number[] {
  const cleaned = values
    .map((value) => Math.trunc(Number(value)))
    .filter(
      (value) =>
        Number.isFinite(value) && value > 0 && value <= MAX_REVIEW_OFFSET_DAYS,
    );

  return [...new Set(cleaned)].sort((a, b) => b - a);
}

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

export const USER_ROLES = ["ADMIN", "MANAGER", "USER"] as const;
export type UserRoleValue = (typeof USER_ROLES)[number];

const ROLE_LABELS: Record<UserRoleValue, string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  USER: "User",
};

export function roleLabel(role: UserRoleValue): string {
  return ROLE_LABELS[role];
}

/**
 * What each role may do. Ordered least to most privileged so checks can be
 * written as a comparison rather than a chain of equality tests.
 */
const ROLE_RANK: Record<UserRoleValue, number> = {
  USER: 0,
  MANAGER: 1,
  ADMIN: 2,
};

export function hasAtLeastRole(
  role: UserRoleValue,
  minimum: UserRoleValue,
): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Only managers and administrators may assign work to somebody else. */
export function canAssignOthers(role: UserRoleValue): boolean {
  return hasAtLeastRole(role, "MANAGER");
}

/** Only administrators may manage users, settings and event types. */
export function canAdminister(role: UserRoleValue): boolean {
  return role === "ADMIN";
}

/* -------------------------------------------------------------------------- */
/* Assignment                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How a NULL assignee reads in the UI. Deliberately a display constant: there
 * is no "Unassigned" user row in the database, and there must never be one.
 */
export const UNASSIGNED_LABEL = "Unassigned";

/** Filter sentinels for "no value set". Never database values. */
export const UNASSIGNED_FILTER = "UNASSIGNED";

/* -------------------------------------------------------------------------- */
/* Stage status                                                               */
/* -------------------------------------------------------------------------- */

export const STAGE_STATUSES = ["PENDING", "DONE", "SKIPPED"] as const;
export type StageStatusValue = (typeof STAGE_STATUSES)[number];

/* -------------------------------------------------------------------------- */
/* User colors                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Palette offered when creating a user.
 *
 * Chosen to stay distinguishable against both the light and dark surfaces, and
 * to remain separable for the most common forms of color vision deficiency —
 * these dots are an identity cue in dense dropdowns, so two teammates reading
 * as "the same color" defeats the point. Color is never the only cue; the
 * name is always beside it.
 */
export const USER_COLOR_PALETTE = [
  "#2563eb", // blue
  "#0891b2", // cyan
  "#059669", // green
  "#ca8a04", // amber
  "#ea580c", // orange
  "#dc2626", // red
  "#db2777", // pink
  "#7c3aed", // violet
  "#4f46e5", // indigo
  "#0f766e", // teal
  "#65a30d", // lime
  "#64748b", // slate
] as const;

export const DEFAULT_USER_COLOR = "#64748b";

const HEX_COLOR = /^#[0-9a-f]{6}$/;

export function isValidUserColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/** Normalises `#ABC123` → `#abc123`, matching the database CHECK constraint. */
export function normaliseUserColor(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Picks readable foreground text for a colored chip.
 *
 * Uses the WCAG relative-luminance formula rather than a naive average, so a
 * mid-tone green and a mid-tone blue resolve correctly instead of one of them
 * ending up unreadable.
 */
export function readableTextColor(hex: string): "#ffffff" | "#0f172a" {
  const normalised = normaliseUserColor(hex);
  if (!HEX_COLOR.test(normalised)) return "#ffffff";

  const channel = (offset: number) => {
    const value = parseInt(normalised.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  const luminance =
    0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);

  return luminance > 0.45 ? "#0f172a" : "#ffffff";
}

/* -------------------------------------------------------------------------- */
/* Themes                                                                     */
/* -------------------------------------------------------------------------- */

export const THEMES = ["light", "dark", "blossom"] as const;
export type ThemeValue = (typeof THEMES)[number];

export const THEME_LABELS: Record<ThemeValue, string> = {
  light: "Light",
  dark: "Dark",
  blossom: "Blossom",
};

export function isTheme(value: unknown): value is ThemeValue {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}
