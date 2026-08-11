/**
 * Request validation.
 *
 * Every mutation is validated here on the server, regardless of what the client
 * already checked. Client-side validation is a convenience; this is the
 * boundary that actually protects the data.
 */

import { z } from "zod";
import { isPlainDate, toPlainDate, type PlainDate } from "@/lib/date/plain-date";
import {
  MAX_REVIEW_OFFSET_DAYS,
  THEMES,
  USER_ROLES,
} from "@/lib/domain/constants";

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A calendar date.
 *
 * Rejects anything that is not a real `YYYY-MM-DD` date. There is deliberately
 * no fallback: an unparseable date is an error, never "today". Silently
 * substituting today's date would fabricate a review schedule around a date
 * nobody chose.
 */
export const plainDateSchema: z.ZodType<PlainDate, z.ZodTypeDef, unknown> = z
  .string()
  .trim()
  .refine(isPlainDate, { message: "Enter a valid calendar date (YYYY-MM-DD)." })
  .transform((value) => toPlainDate(value));

const uuidSchema = z.string().uuid("Expected a valid id.");

/** Trims, and converts an empty string to `null` so blank inputs clear a column. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer.`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

/** An optional foreign key where `null` means "clear the assignment". */
const optionalUuid = z
  .union([uuidSchema, z.literal(""), z.null()])
  .transform((value) => (value === "" || value === null ? null : value))
  .optional();

/**
 * A boolean query flag. Absent means `false`.
 *
 * Deliberately not `z.coerce.boolean()`: that runs `Boolean("false")`, which is
 * `true`, so `?mine=false` would silently mean the opposite of what it says.
 */
const booleanFlag = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((value) => value === "true" || value === "1");

const hexColorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, "Color must be a hex value such as #2563eb.");

/* -------------------------------------------------------------------------- */
/* Events                                                                     */
/* -------------------------------------------------------------------------- */

export const createEventSchema = z.object({
  eventDate: plainDateSchema,
  eventTypeId: uuidSchema,
  // Away/home are optional: not every tracked event is a two-team matchup.
  awayTeam: optionalText(160),
  homeTeam: optionalText(160),
  venue: optionalText(200),
  assigneeId: optionalUuid,
});

export type CreateEventInput = z.infer<typeof createEventSchema>;

/**
 * Event edits are a partial patch — only the keys actually present are written.
 *
 * `status`, `promotedAt` and every completion timestamp are absent by design:
 * they are system-controlled and derived from the checkbox flags below, so no
 * client can set them directly at any role level.
 */
export const updateEventSchema = z
  .object({
    eventDate: plainDateSchema.optional(),
    eventTypeId: uuidSchema.optional(),
    awayTeam: optionalText(160),
    homeTeam: optionalText(160),
    venue: optionalText(200),
    assigneeId: optionalUuid,
    /** Ticking this promotes the event into C1. */
    complete: z.boolean().optional(),
    seatGeekChecked: z.boolean().optional(),
    ticketDataChecked: z.boolean().optional(),
    audited: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No changes were supplied.",
  });

export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const dashboardQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  eventTypeId: z.string().trim().optional(),
  assigneeId: z.string().trim().optional(),
  from: plainDateSchema.optional(),
  to: plainDateSchema.optional(),
  includePromoted: booleanFlag,
  flaggedOnly: booleanFlag,
  sort: z
    .enum([
      "eventDate",
      "eventType",
      "awayTeam",
      "homeTeam",
      "venue",
      "assignee",
      "createdAt",
    ])
    .optional(),
  direction: z.enum(["asc", "desc"]).optional(),
});

/** Raising a flag. The reason is optional — sometimes "look at this" is enough. */
export const flagEventSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(500, "Keep the reason under 500 characters.")
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional(),
});

/* -------------------------------------------------------------------------- */
/* C1 stages                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The complete set of user-mutable stage fields.
 *
 * `eventId`, `offsetDays` and `status` are absent by design — the status is
 * derived from `done`, and the rest are system-controlled.
 */
export const updateStageSchema = z
  .object({
    assigneeId: optionalUuid,
    reviewDue: plainDateSchema.optional(),
    done: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No changes were supplied.",
  });

export type UpdateStageInput = z.infer<typeof updateStageSchema>;

export const c1QuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  eventTypeId: z.string().trim().optional(),
  assigneeId: z.string().trim().optional(),
  stageOffset: z.coerce.number().int().positive().optional(),
  dueFrom: plainDateSchema.optional(),
  dueTo: plainDateSchema.optional(),
  dueRange: z.enum(["TODAY", "THIS_WEEK", "NEXT_WEEK"]).optional(),
});

/** A person's own preferences, editable by that person for themselves. */
export const updatePreferencesSchema = z.object({
  theme: z.enum(THEMES).nullable(),
});

/**
 * Bulk review-due edit. Exactly one of `reviewDue` or `shiftDays` — setting an
 * absolute date and a relative shift at once has no coherent meaning.
 */
export const bulkReviewDueSchema = z
  .object({
    stageIds: z.array(uuidSchema).min(1, "Select at least one row.").max(500),
    reviewDue: plainDateSchema.optional(),
    shiftDays: z.number().int().min(-365).max(365).optional(),
  })
  .refine(
    (value) =>
      (value.reviewDue !== undefined) !== (value.shiftDays !== undefined),
    { message: "Choose either a new date or a number of days to shift by." },
  );

export const auditQuerySchema = z.object({
  entityType: z
    .enum([
      "EVENT",
      "REVIEW_STAGE",
      "EVENT_NOTE",
      "EVENT_TYPE",
      "USER",
      "SETTINGS",
      "IMPERSONATION",
      "MAINTENANCE",
    ])
    .optional(),
  userId: z.string().trim().uuid().optional(),
  action: z.string().trim().max(64).optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().trim().uuid().optional(),
});

/* -------------------------------------------------------------------------- */
/* Notes                                                                      */
/* -------------------------------------------------------------------------- */

export const createNoteSchema = z.object({
  body: z.string().trim().min(1, "A note cannot be empty.").max(4000),
});

export const updateNoteSchema = createNoteSchema;

/* -------------------------------------------------------------------------- */
/* Presence                                                                   */
/* -------------------------------------------------------------------------- */

export const presenceContextSchema = z.enum(["DASHBOARD", "C1"]);

export const presenceActionSchema = z.object({
  eventId: uuidSchema.optional(),
  context: presenceContextSchema,
  action: z.enum(["START", "STOP", "HEARTBEAT", "CLEAR"]),
});

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  displayName: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(120, "Name must be 120 characters or fewer."),
  role: z.enum(USER_ROLES).default("USER"),
  active: z.boolean().default(true),
  color: hexColorSchema.optional(),
  /** Omit to create an account that can only sign in via Google. */
  password: z
    .string()
    .min(10, "Password must be at least 10 characters.")
    .max(200)
    .optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    displayName: z.string().trim().min(1).max(120).optional(),
    role: z.enum(USER_ROLES).optional(),
    active: z.boolean().optional(),
    color: hexColorSchema.optional(),
    password: z.string().min(10).max(200).optional(),
    clockifyUserId: z.string().trim().max(64).nullable().optional(),
    excludeFromTimeReport: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No changes were supplied.",
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

/* -------------------------------------------------------------------------- */
/* Event types                                                                */
/* -------------------------------------------------------------------------- */

/** A short emoji, or empty to clear it. Length-capped so it stays one glyph. */
const emojiSchema = z
  .string()
  .trim()
  .max(8, "Use a single emoji.")
  .transform((value) => (value.length === 0 ? null : value))
  .nullable();

export const createEventTypeSchema = z.object({
  name: z.string().trim().min(1, "Type name is required.").max(80),
  emoji: emojiSchema.optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const updateEventTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    emoji: emojiSchema.optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No changes were supplied.",
  });

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export const updateSettingsSchema = z
  .object({
    siteName: z.string().trim().min(1).max(80).optional(),
    timeZone: z.string().trim().min(1).max(80).optional(),
    reviewOffsets: z
      .array(z.number().int().positive().max(MAX_REVIEW_OFFSET_DAYS))
      .min(1, "At least one review stage is required.")
      .max(20, "That is more stages than anyone can usefully track.")
      .optional(),
    weekendAdjustment: z.boolean().optional(),
    presenceTimeoutMinutes: z.number().int().min(1).max(120).optional(),
    defaultTheme: z.enum(THEMES).optional(),
    seatGeekLinksEnabled: z.boolean().optional(),
    stubHubLinksEnabled: z.boolean().optional(),
    clockifyEnabled: z.boolean().optional(),
    // The workspace id is not a secret. The API key deliberately is not settable
    // here — it lives in CLOCKIFY_API_KEY so a database dump never carries a
    // live credential.
    clockifyWorkspaceId: z.string().trim().max(64).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "No changes were supplied.",
  });

/* -------------------------------------------------------------------------- */
/* Import                                                                     */
/* -------------------------------------------------------------------------- */

export const importSchema = z.object({
  text: z.string().min(1, "Paste some rows first.").max(1_000_000),
  commit: z.boolean().default(false),
});

/* -------------------------------------------------------------------------- */
/* Impersonation                                                              */
/* -------------------------------------------------------------------------- */

export const impersonateSchema = z.object({
  /** `null` ends impersonation and returns to your own account. */
  userId: z.union([uuidSchema, z.null()]),
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Flattens a Zod error into `{ field: [messages] }` for form display. */
export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (result[key] ??= []).push(issue.message);
  }
  return result;
}

/** Reads a `URLSearchParams` into a plain object for schema parsing. */
export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (value !== "") result[key] = value;
  }
  return result;
}
