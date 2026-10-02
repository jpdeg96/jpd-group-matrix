/**
 * What a person can be pushed about, and what they can turn off.
 *
 * Stored as the *muted* set rather than the enabled one. Three reasons, and
 * the third is the one that matters:
 *
 *  - Somebody who has gone to the trouble of enabling notifications on a device
 *    has opted in already; everything on is the right starting point.
 *  - An empty array is a complete, correct preference for a new account, so
 *    there is no backfill to get wrong.
 *  - A category added later is on for everybody by default, with no migration
 *    and no per-user decision to make. Storing the enabled set would mean every
 *    new category starts silently off for every existing person, which looks
 *    exactly like the feature being broken.
 */

import type { NotificationKind } from "@prisma/client";
import type { Permission } from "./permissions";

export const PUSH_CATEGORY_KEYS = [
  "MENTIONS",
  "FLAGS_RAISED",
  "FLAGS_RESOLVED",
  "CLOCK",
] as const;

export type PushCategory = (typeof PUSH_CATEGORY_KEYS)[number];

export interface PushCategoryEntry {
  key: PushCategory;
  label: string;
  detail: string;
  /**
   * Set when the category is only meaningful for somebody whose role may hear
   * it at all. The switch is a person's own call about their phone; this is
   * whether the question applies to them.
   */
  permission?: Permission;
}

export const PUSH_CATEGORIES: readonly PushCategoryEntry[] = [
  {
    key: "MENTIONS",
    label: "Mentions",
    detail: "When somebody writes your name in a note.",
  },
  {
    key: "FLAGS_RAISED",
    label: "Flags raised",
    detail: "When a flag is raised on an event you hold, or escalated to you.",
  },
  {
    key: "FLAGS_RESOLVED",
    label: "Flags resolved",
    detail: "When a flag you raised or fixed is marked resolved or cleared.",
  },
  {
    key: "CLOCK",
    label: "Clock in and out",
    detail: "When somebody starts or stops a timer in Clockify.",
    permission: "clock.notify",
  },
];

/**
 * Which switch governs each kind of notification.
 *
 * Fixed and cleared share one. They are both "a flag you were involved in has
 * moved on", and three switches for the lifecycle of one flag is more precision
 * than anybody wants to express about their own phone.
 */
const BY_KIND: Record<NotificationKind, PushCategory> = {
  MENTIONED: "MENTIONS",
  FLAG_RAISED: "FLAGS_RAISED",
  FLAG_FIXED: "FLAGS_RESOLVED",
  FLAG_CLEARED: "FLAGS_RESOLVED",
};

export function categoryForKind(kind: NotificationKind): PushCategory {
  return BY_KIND[kind];
}

export function isPushCategory(value: string): value is PushCategory {
  return (PUSH_CATEGORY_KEYS as readonly string[]).includes(value);
}

/** Drops anything the code does not recognise, so a stale key cannot mute. */
export function cleanMuted(values: readonly string[]): PushCategory[] {
  return [...new Set(values.filter(isPushCategory))];
}

/**
 * Whether this person wants this category on their devices.
 *
 * Says nothing about whether they are *allowed* to hear it — that is the
 * permission, checked where the audience is chosen. A person with the category
 * muted and the permission held still gets the bell entry; it is only the push
 * that is suppressed.
 */
export function wantsPush(
  muted: readonly string[],
  category: PushCategory,
): boolean {
  return !muted.includes(category);
}
