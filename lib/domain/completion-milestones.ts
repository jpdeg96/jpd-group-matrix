/**
 * Daily completion milestones.
 *
 * A milestone is an event count reached *within a shift of eight hours or less*
 * — the achievement is the pace, not the total, so thirty events spread over a
 * twelve-hour day is deliberately not the same thing and is not celebrated.
 */

export interface CompletionMilestone {
  count: number;
  message: string;
}

/** Ascending. The highest one crossed is the one that fires. */
export const COMPLETION_MILESTONES: readonly CompletionMilestone[] = [
  { count: 30, message: "🎉 Nice work! You've completed 30 events today. 👏" },
  { count: 45, message: "🔥 WOW! 45 events is loco! 🌶️🤯" },
  {
    count: 60,
    message: "⚽ GOOOOAAAAALLLLL! 60 events in one day! You're a high performer! 🏆🚀",
  },
] as const;

/** The shift ceiling, in seconds. */
export const MAX_SHIFT_SECONDS = 8 * 60 * 60;

export interface MilestoneInput {
  /** Events this person has completed today, in the business timezone. */
  completedToday: number;
  /**
   * Seconds worked today, from Clockify. `null` when that cannot be known —
   * the integration is off, or this person is not linked to a Clockify user.
   */
  shiftSeconds: number | null;
  /** The highest milestone already celebrated today, or 0 for none. */
  alreadyCelebrated: number;
}

/**
 * The milestone to celebrate right now, or null.
 *
 * Returns the *highest* newly crossed milestone rather than each in turn, so a
 * bulk action that jumps from 29 to 60 produces one celebration rather than
 * three stacked on top of each other.
 *
 * An unknown shift length does not block the celebration. The eight-hour rule
 * exists to keep a long grind from reading as a sprint, and refusing to
 * celebrate anyone whose Clockify account is simply not linked would punish a
 * configuration gap rather than a slow day. When the shift *is* known and over
 * the limit, it blocks.
 */
export function milestoneReached(input: MilestoneInput): CompletionMilestone | null {
  if (input.shiftSeconds !== null && input.shiftSeconds > MAX_SHIFT_SECONDS) {
    return null;
  }

  let reached: CompletionMilestone | null = null;
  for (const milestone of COMPLETION_MILESTONES) {
    if (input.completedToday >= milestone.count && milestone.count > input.alreadyCelebrated) {
      reached = milestone;
    }
  }

  return reached;
}

/** The smallest count worth asking Clockify about. */
export const LOWEST_MILESTONE = COMPLETION_MILESTONES[0]!.count;
