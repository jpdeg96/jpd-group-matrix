/**
 * Bulk import parsing.
 *
 * Pure functions — no database, no I/O — so every quirk of real spreadsheet
 * data is directly testable.
 *
 * WHY NO .xlsx PARSER
 * Copying a range in Excel or Google Sheets puts **tab-separated text** on the
 * clipboard, so pasting is already a first-class Excel import and needs no
 * library at all. Adding a binary .xlsx parser would mean taking on SheetJS,
 * whose npm-published builds have carried known advisories and lag the
 * maintainer's own distribution. For a form that accepts uploads from a browser
 * that is a poor trade against "paste, or Save As CSV".
 */

import { isPlainDate, plainDateFromParts, type PlainDate } from "@/lib/date/plain-date";

export interface ParsedRow {
  /** 1-based row number as the user sees it, for error messages. */
  lineNumber: number;
  eventDate: PlainDate | null;
  type: string;
  awayTeam: string | null;
  homeTeam: string | null;
  venue: string | null;
  assignee: string | null;
  /** Blocking problems. A row with any of these will not be imported. */
  errors: string[];
  /** Non-blocking observations, e.g. a type that will be created. */
  warnings: string[];
  raw: string[];
}

export interface ParseResult {
  rows: ParsedRow[];
  /** True when the first line was consumed as a header. */
  headerDetected: boolean;
  validCount: number;
  errorCount: number;
}

const CANONICAL_FIELDS = [
  "date",
  "type",
  "away",
  "home",
  "venue",
  "assigned",
] as const;

type CanonicalField = (typeof CANONICAL_FIELDS)[number];

/**
 * Maps a header cell onto a known field.
 *
 * Deliberately forgiving: people paste "League", "Away Team / Artist",
 * "Event Date" and similar. Anything unrecognised is ignored rather than
 * shifting every later column.
 */
function matchHeader(cell: string): CanonicalField | null {
  const value = cell.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!value) return null;

  if (value.includes("date")) return "date";
  if (value.includes("type") || value.includes("league")) return "type";
  if (value.includes("away") || value.includes("artist")) return "away";
  if (value.includes("home")) return "home";
  if (value.includes("venue")) return "venue";
  if (value.includes("assign") || value.includes("owner")) return "assigned";

  return null;
}

/** True when a line looks like a header rather than data. */
function looksLikeHeader(cells: string[]): boolean {
  const matched = cells.filter((cell) => matchHeader(cell) !== null).length;
  // Two recognisable headers is a strong signal; a data row would have to be
  // remarkably unlucky to trip this.
  return matched >= 2;
}

/**
 * Splits one delimited line, honouring RFC 4180 style double quotes.
 *
 * Venue and team names contain commas often enough that a naive `split(",")`
 * silently corrupts them.
 */
export function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/**
 * Chooses the delimiter by counting candidates outside quotes.
 *
 * Tabs win ties because an Excel paste is tab-separated and team names contain
 * far more commas than tabs.
 */
export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 5).join("\n");
  const tabs = (sample.match(/\t/g) ?? []).length;
  const commas = (sample.match(/,/g) ?? []).length;
  const semicolons = (sample.match(/;/g) ?? []).length;

  if (tabs > 0 && tabs >= commas) return "\t";
  if (semicolons > commas) return ";";
  return ",";
}

/**
 * Parses a date cell.
 *
 * Accepts ISO `YYYY-MM-DD` and slash/dot separated `M/D/YYYY` in **US order**.
 * It never guesses between the two readings of an ambiguous value like
 * `01/02/2026` — it commits to month-first and the import preview shows the
 * resolved date, so a wrong assumption is visible before anything is written
 * rather than discovered weeks later.
 *
 * Returns `null` for anything unparseable. There is no fallback to today.
 */
export function parseDateCell(raw: string): {
  date: PlainDate | null;
  ambiguous: boolean;
} {
  const value = raw.trim();
  if (!value) return { date: null, ambiguous: false };

  if (isPlainDate(value)) return { date: value, ambiguous: false };

  // Excel sometimes serialises as `2026-08-20 00:00:00`.
  const isoPrefix = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(value);
  if (isoPrefix && isPlainDate(isoPrefix[1]!)) {
    return { date: isoPrefix[1] as PlainDate, ambiguous: false };
  }

  const slash = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(value);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += 2000;

    try {
      const date = plainDateFromParts(year, month, day);
      // Both readings would be valid dates, so the month-first choice matters.
      return { date, ambiguous: day <= 12 && month !== day };
    } catch {
      return { date: null, ambiguous: false };
    }
  }

  return { date: null, ambiguous: false };
}

export interface ParseOptions {
  /** Known type names, for warning about ones that would be created. */
  knownTypes?: readonly string[];
  /** Known user display names, for resolving the Assigned column. */
  knownUsers?: readonly string[];
}

/** Parses pasted or uploaded delimited text into reviewable rows. */
export function parseImport(text: string, options: ParseOptions = {}): ParseResult {
  const delimiter = detectDelimiter(text);
  const lines = text
    .split(/\r?\n/)
    .filter((line, index, all) => line.trim() !== "" || index < all.length - 1)
    .filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return { rows: [], headerDetected: false, validCount: 0, errorCount: 0 };
  }

  const firstCells = splitLine(lines[0]!, delimiter);
  const headerDetected = looksLikeHeader(firstCells);

  // Column order: taken from the header when present, otherwise the documented
  // default that matches the dashboard's own column order.
  let columns: (CanonicalField | null)[];
  if (headerDetected) {
    columns = firstCells.map(matchHeader);
  } else {
    columns = ["date", "type", "away", "home", "venue", "assigned"];
  }

  const knownTypes = new Set(
    (options.knownTypes ?? []).map((name) => name.toLowerCase()),
  );
  const knownUsers = new Set(
    (options.knownUsers ?? []).map((name) => name.toLowerCase()),
  );

  const dataLines = headerDetected ? lines.slice(1) : lines;

  const rows = dataLines.map((line, index): ParsedRow => {
    const cells = splitLine(line, delimiter);
    const errors: string[] = [];
    const warnings: string[] = [];

    const pick = (field: CanonicalField): string => {
      const at = columns.indexOf(field);
      return at >= 0 ? (cells[at] ?? "").trim() : "";
    };

    const rawDate = pick("date");
    const { date, ambiguous } = parseDateCell(rawDate);

    if (!rawDate) {
      errors.push("Date is required.");
    } else if (!date) {
      errors.push(`"${rawDate}" is not a valid date.`);
    } else if (ambiguous) {
      warnings.push(`Read "${rawDate}" as month/day — check this is right.`);
    }

    const type = pick("type");
    if (!type) {
      errors.push("Type is required.");
    } else if (knownTypes.size > 0 && !knownTypes.has(type.toLowerCase())) {
      warnings.push(`Type "${type}" is new and will be created.`);
    }

    const assignee = pick("assigned") || null;
    if (assignee && knownUsers.size > 0 && !knownUsers.has(assignee.toLowerCase())) {
      warnings.push(`No user named "${assignee}" — this row will be left unassigned.`);
    }

    return {
      lineNumber: index + 1 + (headerDetected ? 1 : 0),
      eventDate: date,
      type,
      awayTeam: pick("away") || null,
      homeTeam: pick("home") || null,
      venue: pick("venue") || null,
      assignee,
      errors,
      warnings,
      raw: cells,
    };
  });

  return {
    rows,
    headerDetected,
    validCount: rows.filter((row) => row.errors.length === 0).length,
    errorCount: rows.filter((row) => row.errors.length > 0).length,
  };
}

/**
 * Flags rows that duplicate each other on date + type + teams.
 *
 * Pasting the same range twice is a common slip, and near-identical rows are
 * hard to spot by eye in a long preview.
 */
export function markDuplicates(rows: ParsedRow[]): ParsedRow[] {
  const seen = new Map<string, number>();

  return rows.map((row) => {
    if (row.errors.length > 0) return row;

    const key = [row.eventDate, row.type, row.awayTeam, row.homeTeam]
      .map((part) => (part ?? "").toLowerCase())
      .join("|");

    const firstSeen = seen.get(key);
    if (firstSeen !== undefined) {
      return {
        ...row,
        warnings: [...row.warnings, `Duplicate of row ${firstSeen} in this paste.`],
      };
    }

    seen.set(key, row.lineNumber);
    return row;
  });
}
