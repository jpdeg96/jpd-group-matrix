import { describe, expect, it } from "vitest";
import { normaliseSheetId, sheetToText, sheetUrl } from "@/lib/services/google-sheets";

describe("normaliseSheetId", () => {
  it("takes a bare id unchanged", () => {
    expect(normaliseSheetId("1AbC-dEf_123")).toBe("1AbC-dEf_123");
  });

  it("pulls the id out of a pasted edit URL", () => {
    // Which is what people actually paste — the id is the unmemorable middle.
    expect(
      normaliseSheetId("https://docs.google.com/spreadsheets/d/1AbC-dEf_123/edit#gid=0"),
    ).toBe("1AbC-dEf_123");
  });

  it("pulls the id out of a URL with no trailing path", () => {
    expect(normaliseSheetId("https://docs.google.com/spreadsheets/d/1AbC-dEf_123")).toBe(
      "1AbC-dEf_123",
    );
  });

  it("trims surrounding space", () => {
    expect(normaliseSheetId("  1AbC  ")).toBe("1AbC");
  });

  it("treats blank and null as nothing linked", () => {
    expect(normaliseSheetId("")).toBeNull();
    expect(normaliseSheetId("   ")).toBeNull();
    expect(normaliseSheetId(null)).toBeNull();
  });
});

describe("sheetUrl", () => {
  it("builds a link a person can open", () => {
    expect(sheetUrl("1AbC")).toBe("https://docs.google.com/spreadsheets/d/1AbC/edit");
  });

  it("round-trips a pasted URL, so the link always points where the import reads", () => {
    expect(sheetUrl("https://docs.google.com/spreadsheets/d/1AbC/edit#gid=7")).toBe(
      "https://docs.google.com/spreadsheets/d/1AbC/edit",
    );
  });

  it("is null when nothing is linked, so no broken link is rendered", () => {
    expect(sheetUrl(null)).toBeNull();
    expect(sheetUrl("")).toBeNull();
  });
});

describe("sheetToText", () => {
  it("joins cells with tabs and rows with newlines", () => {
    expect(
      sheetToText([
        ["Date", "Type", "Away"],
        ["2026-09-12", "NFL", "Chiefs"],
      ]),
    ).toBe("Date\tType\tAway\n2026-09-12\tNFL\tChiefs");
  });

  it("pads short rows out to the widest", () => {
    // Google omits trailing empty cells rather than padding them, so a row
    // ending in blanks arrives shorter and would otherwise stop lining up with
    // the header.
    expect(sheetToText([["Date", "Type", "Venue"], ["2026-09-12", "NFL"]])).toBe(
      "Date\tType\tVenue\n2026-09-12\tNFL\t",
    );
  });

  it("collapses tabs and newlines inside a cell", () => {
    // A cell containing a newline would otherwise invent a row nobody typed.
    expect(sheetToText([["a\nb", "c\td"]])).toBe("a b\tc d");
  });

  it("trims each cell", () => {
    expect(sheetToText([["  Chiefs  ", " Bills "]])).toBe("Chiefs\tBills");
  });

  it("returns an empty string for no rows", () => {
    expect(sheetToText([])).toBe("");
  });
});
