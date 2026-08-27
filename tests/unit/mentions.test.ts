import { describe, expect, it } from "vitest";
import { findMentions } from "@/lib/domain/mentions";

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
