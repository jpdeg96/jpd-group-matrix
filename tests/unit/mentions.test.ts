import { describe, expect, it } from "vitest";
import { findMentions, splitMentions } from "@/lib/domain/mentions";

const PEOPLE = [
  { id: "dana", displayName: "Dana Whitfield" },
  { id: "dana-b", displayName: "Dana" },
  { id: "marco", displayName: "Marco Ruiz" },
  { id: "avery", displayName: "Avery Chen" },
];

describe("findMentions", () => {
  it("finds a full name containing a space", () => {
    expect(findMentions("@Marco Ruiz can you look at this", PEOPLE)).toEqual([
      { id: "marco", displayName: "Marco Ruiz" },
    ]);
  });

  it("prefers the longer name when one is a prefix of another", () => {
    // The whole reason this is not a whitespace-delimited regex: "@Dana
    // Whitfield" must not resolve to the person called "Dana".
    expect(findMentions("@Dana Whitfield please check", PEOPLE)).toEqual([
      { id: "dana", displayName: "Dana Whitfield" },
    ]);
  });

  it("still matches the short name on its own", () => {
    expect(findMentions("thanks @Dana", PEOPLE)).toEqual([
      { id: "dana-b", displayName: "Dana" },
    ]);
  });

  it("is case-insensitive", () => {
    expect(findMentions("@marco ruiz", PEOPLE).map((user) => user.id)).toEqual(["marco"]);
  });

  it("finds several people in one note", () => {
    const found = findMentions("@Avery Chen and @Marco Ruiz — see below", PEOPLE);
    expect(found.map((user) => user.id).sort()).toEqual(["avery", "marco"]);
  });

  it("does not match a name that runs into another word", () => {
    expect(findMentions("@Danaher is a company", PEOPLE)).toEqual([]);
  });

  it("ignores an @ in the middle of a word, like an email address", () => {
    expect(findMentions("mail dana@jpdgroup.test about it", PEOPLE)).toEqual([]);
  });

  it("returns nothing for a note with no mentions", () => {
    expect(findMentions("Checked against the source file.", PEOPLE)).toEqual([]);
  });

  it("does not repeat somebody mentioned twice", () => {
    expect(findMentions("@Marco Ruiz — and again @Marco Ruiz", PEOPLE)).toHaveLength(1);
  });

  it("tolerates trailing punctuation", () => {
    expect(findMentions("@Avery Chen, please confirm.", PEOPLE).map((u) => u.id)).toEqual([
      "avery",
    ]);
  });
});

describe("splitMentions", () => {
  it("splits text around a mention", () => {
    expect(splitMentions("ask @Marco Ruiz about it", PEOPLE)).toEqual([
      { text: "ask ", user: null },
      { text: "@Marco Ruiz", user: { id: "marco", displayName: "Marco Ruiz" } },
      { text: " about it", user: null },
    ]);
  });

  it("returns one plain run when nothing is mentioned", () => {
    expect(splitMentions("nothing here", PEOPLE)).toEqual([
      { text: "nothing here", user: null },
    ]);
  });

  it("handles a mention at the very start and very end", () => {
    expect(splitMentions("@Dana", PEOPLE)).toEqual([
      { text: "@Dana", user: { id: "dana-b", displayName: "Dana" } },
    ]);
  });

  it("highlights every occurrence, not just the first", () => {
    // findMentions reports one person once; the rendering has to mark them
    // wherever they appear, or the second mention looks like plain text.
    const segments = splitMentions("@Dana and again @Dana", PEOPLE);
    expect(segments.filter((segment) => segment.user !== null)).toHaveLength(2);
    expect(findMentions("@Dana and again @Dana", PEOPLE)).toHaveLength(1);
  });

  it("reassembles into exactly the original text", () => {
    // The rendered note must be the note. Any drift here silently rewrites what
    // somebody wrote.
    const body = "@Avery Chen — see @Marco Ruiz's comment, cc @Dana Whitfield.";
    expect(splitMentions(body, PEOPLE).map((s) => s.text).join("")).toBe(body);
  });

  it("does not highlight an email address", () => {
    const segments = splitMentions("mail dana@jpdgroup.test today", PEOPLE);
    expect(segments.every((segment) => segment.user === null)).toBe(true);
  });

  it("carries the colour through for rendering", () => {
    const coloured = [{ id: "marco", displayName: "Marco Ruiz", color: "#ca8a04" }];
    const segments = splitMentions("hi @Marco Ruiz", coloured);
    expect(segments[1]?.user?.color).toBe("#ca8a04");
  });
});
