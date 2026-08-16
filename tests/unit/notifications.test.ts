/**
 * The parts of the integrations that can be wrong without anything throwing.
 *
 * Delivery is a fetch and is not worth mocking; what is worth testing is the
 * logic that decides *whether* to send and *what it says* — a wrong answer
 * there is silent, and shows up as either a channel full of duplicates or a
 * release nobody was told about.
 */

import { describe, expect, it } from "vitest";
import type { Announcement } from "@/lib/domain/announcements";
import { releasesSince } from "@/lib/notify/watchers";
import { clockifyHealthMessage, payrollMessage, releaseMessage } from "@/lib/notify/messages";
import { normaliseDriveFolderId } from "@/lib/services/settings";
import { buildJwtClaims } from "@/lib/services/google-drive";

const entry = (id: string, title = id): Announcement => ({
  id,
  date: "Aug 16, 2026",
  kind: "added",
  title,
  body: `body of ${id}`,
});

/** Newest first, as the real list is. */
const LIST = [entry("c"), entry("b"), entry("a")];

describe("releasesSince", () => {
  it("returns what is newer than the last one posted", () => {
    expect(releasesSince(LIST, "a").map((item) => item.id)).toEqual(["c", "b"]);
    expect(releasesSince(LIST, "b").map((item) => item.id)).toEqual(["c"]);
  });

  it("returns nothing when the newest has already been posted", () => {
    expect(releasesSince(LIST, "c")).toEqual([]);
  });

  it("returns nothing on the very first run", () => {
    // Otherwise switching notifications on would announce the entire history.
    expect(releasesSince(LIST, null)).toEqual([]);
  });

  it("falls back to the whole list when the stored id is unknown", () => {
    // A rollback or a hand-edited row. Saying too much once beats going silent.
    expect(releasesSince(LIST, "gone").map((item) => item.id)).toEqual(["c", "b", "a"]);
  });

  it("handles an empty list without throwing", () => {
    expect(releasesSince([], "a")).toEqual([]);
  });
});

describe("releaseMessage", () => {
  it("leads with the change itself when there is only one", () => {
    const message = releaseMessage([entry("x", "C1 opens on today")]);
    expect(message.title).toContain("C1 opens on today");
    expect(message.description).toBe("body of x");
    // One change needs no field list; the description already carries it.
    expect(message.fields).toBeUndefined();
  });

  it("summarises and lists when there are several", () => {
    const message = releaseMessage(LIST);
    expect(message.title).toContain("3 changes are live");
    expect(message.fields).toHaveLength(3);
  });
});

describe("payrollMessage", () => {
  const base = {
    periodLabel: "10 Aug – 16 Aug",
    sent: 4,
    skipped: 0,
    failed: 0,
    total: "$1,240.00",
    sentBy: "Avery Chen",
  };

  it("reads as clean when nothing failed", () => {
    const message = payrollMessage(base);
    expect(message.title).toBe("Payroll remittance sent");
    expect(message.tone).toBe("good");
    expect(message.fields?.map((field) => field.name)).not.toContain("Failed");
  });

  it("says so, and how to recover, when something failed", () => {
    const message = payrollMessage({ ...base, failed: 2 });
    expect(message.title).toContain("with failures");
    expect(message.tone).toBe("warn");
    const failed = message.fields?.find((field) => field.name === "Failed");
    expect(failed?.value).toContain("retry");
  });

  it("only mentions skips when there were some", () => {
    expect(payrollMessage(base).fields?.some((f) => f.name === "Skipped")).toBe(false);
    expect(payrollMessage({ ...base, skipped: 1 }).fields?.some((f) => f.name === "Skipped")).toBe(
      true,
    );
  });
});

describe("clockifyHealthMessage", () => {
  it("warns on the way down and says what is unaffected", () => {
    const message = clockifyHealthMessage(false, "504 from Clockify");
    expect(message.tone).toBe("warn");
    expect(message.description).toContain("Event review is unaffected");
    expect(message.fields?.[0]?.value).toBe("504 from Clockify");
  });

  it("is positive on the way back up and carries no detail", () => {
    const message = clockifyHealthMessage(true, null);
    expect(message.tone).toBe("good");
    expect(message.fields).toBeUndefined();
  });
});

describe("normaliseDriveFolderId", () => {
  it("takes the id out of a pasted folder URL", () => {
    expect(normaliseDriveFolderId("https://drive.google.com/drive/folders/1AbC_dEf-123")).toBe(
      "1AbC_dEf-123",
    );
  });

  it("ignores query strings and fragments on that URL", () => {
    expect(
      normaliseDriveFolderId("https://drive.google.com/drive/folders/1AbC?usp=sharing"),
    ).toBe("1AbC");
  });

  it("leaves a bare id alone", () => {
    expect(normaliseDriveFolderId("1AbC_dEf-123")).toBe("1AbC_dEf-123");
  });

  it("treats blank as unset", () => {
    expect(normaliseDriveFolderId("   ")).toBeNull();
    expect(normaliseDriveFolderId(null)).toBeNull();
  });
});

describe("buildJwtClaims", () => {
  it("requests only the scope it needs", () => {
    const claims = buildJwtClaims("bot@project.iam.gserviceaccount.com", 1_000);
    // drive.file grants access to files this application created and nothing
    // else in the Drive. Widening it would be a silent privilege escalation.
    expect(claims.scope).toBe("https://www.googleapis.com/auth/drive.file");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
  });

  it("expires an hour out, which is Google's maximum", () => {
    const claims = buildJwtClaims("bot@example.com", 1_000);
    expect(claims.exp - claims.iat).toBe(3600);
  });
});
