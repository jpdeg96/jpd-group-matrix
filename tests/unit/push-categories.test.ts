/**
 * Notification categories.
 *
 * Pure rules, so they live here rather than in an integration suite. The one
 * that matters most is the default: a person who has never touched a switch
 * must receive everything, including a category added after they last looked.
 */

import { describe, expect, it } from "vitest";
import {
  categoryForKind,
  cleanMuted,
  isPushCategory,
  PUSH_CATEGORIES,
  PUSH_CATEGORY_KEYS,
  wantsPush,
} from "@/lib/domain/push-categories";

describe("push categories", () => {
  it("sends everything to somebody who has never changed anything", () => {
    // The whole reason the muted set is stored rather than the enabled one.
    for (const key of PUSH_CATEGORY_KEYS) {
      expect(wantsPush([], key)).toBe(true);
    }
  });

  it("treats a category nobody has heard of as wanted", () => {
    // A key added in a later release is absent from everybody's stored list,
    // and absent must mean on — otherwise the feature ships silently off.
    expect(wantsPush(["MENTIONS"], "CLOCK")).toBe(true);
  });

  it("suppresses only what was muted", () => {
    expect(wantsPush(["CLOCK"], "CLOCK")).toBe(false);
    expect(wantsPush(["CLOCK"], "MENTIONS")).toBe(true);
  });

  it("maps every notification kind to a category", () => {
    // A kind with no category would throw at send time, inside a catch that
    // silently drops the push — the worst possible place to find out.
    const kinds = ["FLAG_RAISED", "FLAG_FIXED", "FLAG_CLEARED", "MENTIONED"] as const;
    for (const kind of kinds) {
      expect(isPushCategory(categoryForKind(kind))).toBe(true);
    }
  });

  it("puts a flag being fixed and cleared under one switch", () => {
    expect(categoryForKind("FLAG_FIXED")).toBe("FLAGS_RESOLVED");
    expect(categoryForKind("FLAG_CLEARED")).toBe("FLAGS_RESOLVED");
  });

  it("drops keys the code does not know", () => {
    // A stale name from an old client must not be stored, or the next reader
    // has to wonder whether it means something.
    expect(cleanMuted(["MENTIONS", "DRAGONS", ""])).toEqual(["MENTIONS"]);
  });

  it("deduplicates", () => {
    expect(cleanMuted(["CLOCK", "CLOCK"])).toEqual(["CLOCK"]);
  });

  it("describes every key exactly once", () => {
    const described = PUSH_CATEGORIES.map((entry) => entry.key).sort();
    expect(described).toEqual([...PUSH_CATEGORY_KEYS].sort());
  });

  it("gates the clock category on the permission that governs it", () => {
    // Without this the switch would be offered to people who cannot be told
    // either way, implying they are missing something they never had.
    const clock = PUSH_CATEGORIES.find((entry) => entry.key === "CLOCK");
    expect(clock?.permission).toBe("clock.notify");
  });
});
