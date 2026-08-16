/**
 * A minimal read-only .xlsx reader.
 *
 * Deliberately not a dependency. SheetJS's npm builds have carried known
 * advisories, and this application already refuses to bundle a spreadsheet
 * parser for the bulk-import feature — pulling one in for a single migration
 * would be a poor trade. An .xlsx is a zip of XML, and reading the handful of
 * parts we need is well under a hundred lines.
 *
 * Read-only, and only the pieces a migration needs: sheet names, cell values,
 * shared strings, and the date-serial conversion. It is not a general parser
 * and should not grow into one.
 */

import { inflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";

/* -------------------------------------------------------------------------- */
/* Zip                                                                        */
/* -------------------------------------------------------------------------- */

const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;

/** Every file in the archive, by name. */
function unzip(buffer: Buffer): Map<string, Buffer> {
  // The end-of-central-directory record is last, after a comment of unknown
  // length, so it is found by scanning backwards for its signature.
  let end = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === SIG_END) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("Not a zip file: no end-of-central-directory record.");

  const entryCount = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);

  const files = new Map<string, Buffer>();

  for (let n = 0; n < entryCount; n += 1) {
    if (buffer.readUInt32LE(cursor) !== SIG_CENTRAL) break;

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);

    // The local header repeats the name and extra field, at its own lengths.
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    files.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

/* -------------------------------------------------------------------------- */
/* XML                                                                        */
/* -------------------------------------------------------------------------- */

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9A-Fa-f]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    // Excel escapes characters it cannot store directly, emoji included.
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

/** `C12` → 2. */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const character of letters) n = n * 26 + (character.charCodeAt(0) - 64);
  return n - 1;
}

/* -------------------------------------------------------------------------- */
/* Workbook                                                                   */
/* -------------------------------------------------------------------------- */

export interface Cell {
  /** Raw text. Numbers and dates arrive as their serial, unformatted. */
  value: string;
  type: string;
}

export type Row = (Cell | undefined)[];

export class Workbook {
  private constructor(
    private readonly files: Map<string, Buffer>,
    private readonly strings: string[],
    /** Sheet name → part name. */
    readonly sheets: Map<string, string>,
  ) {}

  static open(path: string): Workbook {
    const files = unzip(readFileSync(path));

    const sharedXml = files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
    const strings: string[] = [];
    for (const si of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      // Rich text splits one value across several <t> runs.
      const parts = [...si[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]!);
      strings.push(decodeEntities(parts.join("")));
    }

    const workbookXml = files.get("xl/workbook.xml")?.toString("utf8") ?? "";
    const relsXml = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";

    const targets = new Map<string, string>();
    for (const m of relsXml.matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      targets.set(m[1]!, m[2]!.replace(/^\/?xl\//, ""));
    }

    const sheets = new Map<string, string>();
    for (const m of workbookXml.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
      const target = targets.get(m[2]!);
      if (target) sheets.set(decodeEntities(m[1]!), `xl/${target}`);
    }

    return new Workbook(files, strings, sheets);
  }

  /** Rows of a sheet, indexed from zero. Sparse where the sheet has gaps. */
  rows(sheetName: string): Row[] {
    const part = this.sheets.get(sheetName);
    if (!part) {
      throw new Error(
        `No sheet named ${JSON.stringify(sheetName)}. Found: ${[...this.sheets.keys()].join(", ")}`,
      );
    }

    const xml = this.files.get(part)?.toString("utf8") ?? "";
    const rows: Row[] = [];

    for (const rowMatch of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: Row = [];

      for (const c of rowMatch[2]!.matchAll(
        /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
      )) {
        const attrs = c[2] ?? "";
        const inner = c[3] ?? "";
        const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "n";

        let value = "";
        if (type === "s") {
          const index = Number(/<v>(\d+)<\/v>/.exec(inner)?.[1]);
          value = this.strings[index] ?? "";
        } else if (type === "inlineStr") {
          value = decodeEntities(
            [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]!).join(""),
          );
        } else {
          value = decodeEntities(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "");
        }

        cells[columnIndex(c[1]!)] = { value: value.trim(), type };
      }

      rows[Number(rowMatch[1]) - 1] = cells;
    }

    return rows;
  }
}

export function text(cell: Cell | undefined): string {
  return cell?.value ?? "";
}

/**
 * An Excel date serial as a UTC instant.
 *
 * 25569 is 1970-01-01 in Excel's numbering, which already contains its famous
 * 1900 leap-year error — anything at or after 1900-03-01 lines up, and every
 * date in this migration is far past that.
 *
 * Returns null for anything outside a plausible range. The source spreadsheet
 * contains six timestamps in the 1900s, which are corruption rather than dates,
 * and letting those through would put a 1907 completion in the database.
 */
export function serialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;

  const date = new Date(Math.round((serial - 25569) * 86_400_000));
  if (Number.isNaN(date.getTime())) return null;

  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;

  return date;
}

/** The calendar date of a serial, ignoring any time component. */
export function serialToPlainDate(serial: number): string | null {
  const date = serialToDate(Math.floor(serial));
  return date ? date.toISOString().slice(0, 10) : null;
}
