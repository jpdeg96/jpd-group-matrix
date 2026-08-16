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
import {
  buildJwtClaims,
  buildMultipartBody,
  describeDriveError,
} from "@/lib/services/google-drive";

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
  it("requests the drive scope, not drive.file", () => {
    const claims = buildJwtClaims("bot@project.iam.gserviceaccount.com", 1_000);
    // drive.file covers only files the application itself created, so a folder
    // a person made and shared stays invisible to it — a 404 on a folder that
    // is plainly there with Editor granted. For a service account the sharing
    // is the real boundary anyway: its own Drive is empty, so this reaches
    // exactly the folders somebody deliberately shared with it.
    expect(claims.scope).toBe("https://www.googleapis.com/auth/drive");
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
  });

  it("expires an hour out, which is Google's maximum", () => {
    const claims = buildJwtClaims("bot@example.com", 1_000);
    expect(claims.exp - claims.iat).toBe(3600);
  });
});

describe("buildMultipartBody", () => {
  // Bytes that are not valid UTF-8. If the body were ever assembled as a
  // string these would be replaced with U+FFFD and the PDF would arrive
  // corrupt — which Drive accepts happily and only a reader notices.
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x80]);
  const body = buildMultipartBody({ name: "JPD-20260810.pdf" }, bytes, "bnd");

  it("preserves the file bytes exactly", () => {
    expect(body.includes(bytes)).toBe(true);
    // Present once and unaltered: find it, and check the slice matches.
    const at = body.indexOf(bytes);
    expect(body.subarray(at, at + bytes.length).equals(bytes)).toBe(true);
  });

  it("separates every line with CRLF, never a bare LF", () => {
    const text = body.toString("latin1");
    // Strip the binary payload before counting, so its stray 0x0a bytes — if
    // any — are not mistaken for line endings.
    const framing = text.slice(0, text.indexOf("%PDF")) + text.slice(text.lastIndexOf("--bnd--"));
    expect(framing.includes("\n")).toBe(true);
    expect(/[^\r]\n/.test(framing)).toBe(false);
  });

  it("puts a blank line between each part's headers and its content", () => {
    const text = body.toString("latin1");
    expect(text).toContain("Content-Type: application/json; charset=UTF-8\r\n\r\n{");
    expect(text).toContain("Content-Type: application/pdf\r\n\r\n%PDF");
  });

  it("opens each part and closes the whole body with the delimiter", () => {
    const text = body.toString("latin1");
    expect(text.startsWith("--bnd\r\n")).toBe(true);
    // The trailing dashes are what mark the end; without them Drive waits for
    // a part that never comes.
    expect(text.endsWith("\r\n--bnd--\r\n")).toBe(true);
    expect(text.split("--bnd").length - 1).toBe(3);
  });

  it("carries the metadata as JSON", () => {
    const text = body.toString("latin1");
    expect(text).toContain('{"name":"JPD-20260810.pdf"}');
  });
});

describe("describeDriveError", () => {
  const withReason = (reason: string, message: string) => ({
    error: { message, errors: [{ reason, message }] },
  });

  it("explains the storage-quota refusal, which reads as nothing else", () => {
    // The one that catches everybody: reading the folder works, writing never
    // will, and the words "storage quota" do not obviously mean "use a Shared
    // Drive" to anyone who has not hit it before.
    const text = describeDriveError(
      403,
      withReason("storageQuotaExceeded", "Service Accounts do not have storage quota."),
    );
    expect(text).toContain("Shared Drive");
    expect(text).toContain("Content manager");
  });

  it("matches the quota case on the message alone, without a reason code", () => {
    const text = describeDriveError(403, {
      error: { message: "Service Accounts do not have storage quota." },
    });
    expect(text).toContain("Shared Drive");
  });

  it("names Viewer-instead-of-Editor as the permission case", () => {
    const text = describeDriveError(
      403,
      withReason("insufficientFilePermissions", "The user does not have sufficient permissions."),
    );
    expect(text).toContain("Viewer");
  });

  it("recognises the API not being enabled", () => {
    const text = describeDriveError(
      403,
      withReason("accessNotConfigured", "Google Drive API has not been used in project 123."),
    );
    expect(text).toContain("not enabled");
  });

  it("passes Google's own words through when it does not recognise the reason", () => {
    // The previous version substituted a guess here and hid the actual reason,
    // which is how a wrong diagnosis got shown over a correct one.
    const text = describeDriveError(400, withReason("badRequest", "Invalid value for parents."));
    expect(text).toContain("Invalid value for parents.");
    expect(text).toContain("400");
  });

  it("says so rather than inventing a cause when Drive explains nothing", () => {
    expect(describeDriveError(500, null)).toContain("no explanation");
  });
});
