import { describe, expect, it } from "vitest";
import {
  createEventSchema,
  createUserSchema,
  updateEventSchema,
  updateSettingsSchema,
  updateStageSchema,
} from "@/lib/validation/schemas";

const TYPE_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

describe("createEventSchema", () => {
  const valid = {
    eventDate: "2026-09-29",
    eventTypeId: TYPE_ID,
    awayTeam: "Away",
    homeTeam: "Home",
    venue: "Venue",
  };

  it("accepts a well-formed event", () => {
    expect(createEventSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an invalid date instead of falling back to today", () => {
    // The behaviour this replaces silently treated an unparseable date as
    // today, fabricating a schedule around a date nobody chose.
    for (const eventDate of ["", "not-a-date", "2025-02-30", "09/29/2026", "2026-9-29"]) {
      const result = createEventSchema.safeParse({ ...valid, eventDate });
      expect(result.success, `expected "${eventDate}" to be rejected`).toBe(false);
    }
  });

  it("requires a type", () => {
    expect(createEventSchema.safeParse({ ...valid, eventTypeId: "" }).success).toBe(false);
    expect(
      createEventSchema.safeParse({ ...valid, eventTypeId: undefined }).success,
    ).toBe(false);
  });

  it("allows an event with no away or home team", () => {
    const result = createEventSchema.safeParse({
      eventDate: "2026-09-29",
      eventTypeId: TYPE_ID,
      awayTeam: "",
      homeTeam: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Blank optional text becomes NULL rather than an empty string.
      expect(result.data.awayTeam).toBeNull();
      expect(result.data.homeTeam).toBeNull();
    }
  });
});

describe("updateEventSchema", () => {
  it("accepts a single-field patch", () => {
    expect(updateEventSchema.safeParse({ complete: true }).success).toBe(true);
    expect(updateEventSchema.safeParse({ ticketDataChecked: false }).success).toBe(true);
  });

  it("treats an empty assignee as an explicit unassignment", () => {
    const result = updateEventSchema.safeParse({ assigneeId: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.assigneeId).toBeNull();
  });

  it("rejects an empty patch", () => {
    expect(updateEventSchema.safeParse({}).success).toBe(false);
  });

  it("drops system-controlled fields rather than writing them", () => {
    const result = updateEventSchema.safeParse({
      venue: "Somewhere",
      status: "COMPLETED",
      completedAt: "2026-01-01T00:00:00Z",
      promotedAt: "2026-01-01T00:00:00Z",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Only the mutable field survives parsing, so the service never sees the
      // others regardless of what a client sends.
      expect(Object.keys(result.data)).toEqual(["venue"]);
    }
  });
});

describe("updateStageSchema", () => {
  it("accepts done, assignee and a manual review due date", () => {
    expect(updateStageSchema.safeParse({ done: true }).success).toBe(true);
    expect(updateStageSchema.safeParse({ assigneeId: USER_ID }).success).toBe(true);
    expect(updateStageSchema.safeParse({ reviewDue: "2026-09-29" }).success).toBe(true);
  });

  it("rejects an invalid manual review due date", () => {
    expect(updateStageSchema.safeParse({ reviewDue: "soon" }).success).toBe(false);
  });

  it("drops offsetDays and status — both are system-controlled", () => {
    const result = updateStageSchema.safeParse({
      done: true,
      offsetDays: 3,
      status: "SKIPPED",
      eventId: TYPE_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(Object.keys(result.data)).toEqual(["done"]);
  });
});

describe("updateSettingsSchema", () => {
  it("accepts a custom stage list", () => {
    const result = updateSettingsSchema.safeParse({ reviewOffsets: [30, 14, 3] });
    expect(result.success).toBe(true);
  });

  it("rejects an empty stage list", () => {
    expect(updateSettingsSchema.safeParse({ reviewOffsets: [] }).success).toBe(false);
  });

  it("rejects non-positive or absurd offsets", () => {
    expect(updateSettingsSchema.safeParse({ reviewOffsets: [0] }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ reviewOffsets: [-1] }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ reviewOffsets: [400] }).success).toBe(false);
  });

  it("bounds the presence timeout", () => {
    expect(
      updateSettingsSchema.safeParse({ presenceTimeoutMinutes: 5 }).success,
    ).toBe(true);
    expect(
      updateSettingsSchema.safeParse({ presenceTimeoutMinutes: 0 }).success,
    ).toBe(false);
    expect(
      updateSettingsSchema.safeParse({ presenceTimeoutMinutes: 500 }).success,
    ).toBe(false);
  });

  it("rejects an unknown theme", () => {
    expect(updateSettingsSchema.safeParse({ defaultTheme: "neon" }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ defaultTheme: "blossom" }).success).toBe(true);
  });

  it("accepts Phantom Calculator rates as decimal fractions", () => {
    const result = updateSettingsSchema.safeParse({
      phantomTier1Rate: 0.2,
      phantomStubHubRate: 0.25,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phantomTier1Rate).toBe(0.2);
      expect(result.data.phantomStubHubRate).toBe(0.25);
    }
  });

  it("rejects a Phantom rate entered as a percentage", () => {
    // The mistake somebody makes on their first visit to the card. Left
    // unguarded it turns a $600 get-in into a $1.30 maximum purchase price,
    // reported with a straight face.
    expect(updateSettingsSchema.safeParse({ phantomTier1Rate: 20 }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ phantomStubHubRate: 25 }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ phantomTier1Rate: 1 }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ phantomTier1Rate: -0.1 }).success).toBe(false);
  });

  it("allows a Phantom rate to be cleared", () => {
    // Clearing is legitimate: an unset rate stops the desktop calculator
    // answering, which is safer than a stale rate nobody trusts.
    expect(updateSettingsSchema.safeParse({ phantomTier1Rate: null }).success).toBe(true);
  });

  it("rounds a Phantom rate to the column's four decimal places", () => {
    const result = updateSettingsSchema.safeParse({ phantomTier1Rate: 0.20125 });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phantomTier1Rate).toBe(0.2013);
  });
});

describe("createUserSchema", () => {
  it("normalises the email to lowercase", () => {
    const result = createUserSchema.safeParse({
      email: "  Person@Example.COM ",
      displayName: "Person",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("person@example.com");
  });

  it("defaults to an active regular user", () => {
    const result = createUserSchema.safeParse({
      email: "person@example.com",
      displayName: "Person",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("USER");
      expect(result.data.active).toBe(true);
    }
  });

  it("accepts the manager role", () => {
    const result = createUserSchema.safeParse({
      email: "person@example.com",
      displayName: "Person",
      role: "MANAGER",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed color", () => {
    const base = { email: "p@example.com", displayName: "P" };
    expect(createUserSchema.safeParse({ ...base, color: "red" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, color: "#GGG" }).success).toBe(false);
    expect(createUserSchema.safeParse({ ...base, color: "#2563EB" }).success).toBe(true);
  });

  it("rejects a short password", () => {
    const result = createUserSchema.safeParse({
      email: "person@example.com",
      displayName: "Person",
      password: "short",
    });
    expect(result.success).toBe(false);
  });
});
