import { describe, expect, it } from "vitest";
import {
  detectDelimiter,
  markDuplicates,
  parseDateCell,
  parseImport,
  splitLine,
} from "@/lib/domain/import-parse";

describe("splitLine", () => {
  it("splits on the delimiter", () => {
    expect(splitLine("a,b,c", ",")).toEqual(["a", "b", "c"]);
  });

  it("honours quoted fields containing the delimiter", () => {
    // Venue names contain commas often enough that a naive split corrupts them.
    expect(splitLine('2026-09-12,NFL,"Arlington, TX"', ",")).toEqual([
      "2026-09-12",
      "NFL",
      "Arlington, TX",
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(splitLine('"He said ""hi""",NFL', ",")).toEqual(['He said "hi"', "NFL"]);
  });

  it("preserves empty trailing cells", () => {
    expect(splitLine("a,,c,", ",")).toEqual(["a", "", "c", ""]);
  });
});

describe("detectDelimiter", () => {
  it("prefers tabs, which is what an Excel paste produces", () => {
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });

  it("falls back to commas", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
  });

  it("picks tabs even when the data contains more commas", () => {
    expect(detectDelimiter("date\tteam\n2026-09-12\tArlington, TX, USA")).toBe("\t");
  });
});

describe("parseDateCell", () => {
  it("accepts ISO dates", () => {
    expect(parseDateCell("2026-09-12")).toEqual({
      date: "2026-09-12",
      ambiguous: false,
    });
  });

  it("strips an Excel time suffix", () => {
    expect(parseDateCell("2026-09-12 00:00:00").date).toBe("2026-09-12");
  });

  it("reads slash dates month-first and flags the ambiguous ones", () => {
    // Unambiguous: 25 cannot be a month.
    expect(parseDateCell("9/25/2026")).toEqual({
      date: "2026-09-25",
      ambiguous: false,
    });

    // Ambiguous: could be 2 January under a day-first reading. Committed to
    // month-first and flagged so the preview can surface it.
    expect(parseDateCell("01/02/2026")).toEqual({
      date: "2026-01-02",
      ambiguous: true,
    });
  });

  it("expands two-digit years", () => {
    expect(parseDateCell("9/25/26").date).toBe("2026-09-25");
  });

  it("returns null for junk rather than guessing", () => {
    // Never falls back to today — that is the behaviour this replaces.
    expect(parseDateCell("next Tuesday").date).toBeNull();
    expect(parseDateCell("").date).toBeNull();
    expect(parseDateCell("13/45/2026").date).toBeNull();
    expect(parseDateCell("2026-02-30").date).toBeNull();
  });
});

describe("parseImport", () => {
  it("detects a header row and maps loose column names", () => {
    const result = parseImport(
      [
        "Event Date\tLeague\tAway Team / Artist\tHome Team\tVenue",
        "2026-09-12\tNFL\tChiefs\tBills\tHighmark Stadium",
      ].join("\n"),
    );

    expect(result.headerDetected).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      eventDate: "2026-09-12",
      type: "NFL",
      awayTeam: "Chiefs",
      homeTeam: "Bills",
      venue: "Highmark Stadium",
    });
  });

  it("falls back to positional columns with no header", () => {
    const result = parseImport("2026-09-12\tNFL\tChiefs\tBills\tHighmark Stadium");
    expect(result.headerDetected).toBe(false);
    expect(result.rows[0]?.type).toBe("NFL");
  });

  it("reports per-row errors without failing the batch", () => {
    const result = parseImport(
      [
        "2026-09-12\tNFL\tChiefs\tBills",
        "not-a-date\tNFL\tJets\tPatriots",
        "2026-09-14\t\tRams\tNiners",
      ].join("\n"),
    );

    expect(result.validCount).toBe(1);
    expect(result.errorCount).toBe(2);
    expect(result.rows[1]?.errors[0]).toContain("not a valid date");
    expect(result.rows[2]?.errors[0]).toContain("Type is required");
  });

  it("numbers rows as the user sees them, accounting for the header", () => {
    const result = parseImport(
      ["Date\tType\tAway", "2026-09-12\tNFL\tChiefs"].join("\n"),
    );
    // Line 1 is the header, so the first data row is line 2.
    expect(result.rows[0]?.lineNumber).toBe(2);
  });

  it("warns about types that would be created", () => {
    const result = parseImport("2026-09-12\tCurling\tA\tB", {
      knownTypes: ["NFL", "NBA"],
    });
    expect(result.rows[0]?.warnings[0]).toContain("Curling");
    expect(result.rows[0]?.errors).toHaveLength(0);
  });

  it("warns about an unknown assignee instead of rejecting the row", () => {
    const result = parseImport("2026-09-12\tNFL\tA\tB\tVenue\tNobody", {
      knownUsers: ["Dana Whitfield"],
    });
    expect(result.rows[0]?.errors).toHaveLength(0);
    expect(result.rows[0]?.warnings.join(" ")).toContain("Nobody");
  });

  it("ignores blank lines", () => {
    const result = parseImport("2026-09-12\tNFL\tA\tB\n\n\n2026-09-13\tNFL\tC\tD");
    expect(result.rows).toHaveLength(2);
  });
});

describe("markDuplicates", () => {
  it("flags a repeated row, which usually means a double paste", () => {
    const parsed = parseImport(
      [
        "2026-09-12\tNFL\tChiefs\tBills",
        "2026-09-13\tNFL\tJets\tPatriots",
        "2026-09-12\tNFL\tChiefs\tBills",
      ].join("\n"),
    );

    const marked = markDuplicates(parsed.rows);
    expect(marked[0]?.warnings).toHaveLength(0);
    expect(marked[1]?.warnings).toHaveLength(0);
    expect(marked[2]?.warnings.join(" ")).toContain("Duplicate of row 1");
  });
});
