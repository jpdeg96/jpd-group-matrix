import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENTS,
  MAX_SHOWN,
  newestAnnouncementId,
  selectAnnouncements,
  type Announcement,
} from "@/lib/domain/announcements";

const entry = (id: string): Announcement => ({
  id,
  date: "Jan 1, 2026",
  kind: "added",
  title: `Title ${id}`,
  body: `Body ${id}`,
});

/** Newest first, matching the real list's invariant. */
const list = (...ids: string[]) => ids.map(entry);

describe("selectAnnouncements", () => {
  it("shows nothing when the newest is already acknowledged", () => {
    const all = list("c", "b", "a");
    expect(selectAnnouncements("c", all)).toEqual({ shown: [], hiddenCount: 0 });
  });

  it("shows only what arrived since the acknowledged entry", () => {
    const all = list("d", "c", "b", "a");
    const result = selectAnnouncements("b", all);
    expect(result.shown.map((e) => e.id)).toEqual(["d", "c"]);
    expect(result.hiddenCount).toBe(0);
  });

  it("shows the newest first", () => {
    const all = list("d", "c", "b", "a");
    expect(selectAnnouncements("a", all).shown[0]?.id).toBe("d");
  });

  it("shows recent entries to somebody who has acknowledged nothing", () => {
    // A fresh browser. Better a short 'what's new' than silence, since the
    // alternative is that the very first release note reaches nobody.
    const all = list("c", "b", "a");
    expect(selectAnnouncements(null, all).shown.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("caps how many are shown and reports the remainder", () => {
    const all = list("g", "f", "e", "d", "c", "b", "a");
    const result = selectAnnouncements("a", all);
    expect(result.shown).toHaveLength(MAX_SHOWN);
    expect(result.shown.map((e) => e.id)).toEqual(["g", "f", "e", "d", "c"]);
    expect(result.hiddenCount).toBe(1);
  });

  it("falls back to recent entries when the acknowledged id is unknown", () => {
    // An id renamed between builds, or corrupted storage. Re-showing once is a
    // cheaper failure than going permanently silent, which nobody would report.
    const all = list("c", "b", "a");
    expect(selectAnnouncements("gone", all).shown.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("handles an empty list", () => {
    expect(selectAnnouncements(null, [])).toEqual({ shown: [], hiddenCount: 0 });
    expect(selectAnnouncements("anything", [])).toEqual({ shown: [], hiddenCount: 0 });
  });
});

describe("newestAnnouncementId", () => {
  it("is the first entry, which is what gets recorded on dismissal", () => {
    expect(newestAnnouncementId(list("c", "b", "a"))).toBe("c");
  });

  it("is null for an empty list", () => {
    expect(newestAnnouncementId([])).toBeNull();
  });

  it("acknowledging clears everything, including capped-off entries", () => {
    // Recording the newest *shown* id instead would re-offer the remainder on
    // the next load, which would look like the dialog refusing to go away.
    const all = list("g", "f", "e", "d", "c", "b", "a");
    const acknowledged = newestAnnouncementId(all)!;
    expect(selectAnnouncements(acknowledged, all).shown).toEqual([]);
  });
});

describe("the real announcement list", () => {
  it("has unique ids — a reused one announces the wrong thing", () => {
    const ids = ANNOUNCEMENTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the documented YYYY-MM-DD-slug id format", () => {
    for (const announcement of ANNOUNCEMENTS) {
      expect(announcement.id).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
    }
  });

  it("is ordered newest first, which the selection relies on", () => {
    const dates = ANNOUNCEMENTS.map((entry) => entry.id.slice(0, 10));
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("gives every entry a title and a body written for the reader", () => {
    for (const announcement of ANNOUNCEMENTS) {
      expect(announcement.title.length).toBeGreaterThan(5);
      expect(announcement.body.length).toBeGreaterThan(20);
    }
  });
});
