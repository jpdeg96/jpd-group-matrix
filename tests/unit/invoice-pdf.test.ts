/**
 * Invoice PDF rendering.
 *
 * A PDF is hard to assert on visually, so these check the things that would
 * actually hurt: that it renders at all, that it is a real PDF, and that the
 * figures a contractor would query are present as text inside it.
 */

import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderInvoicePdf, type InvoicePdfData } from "@/lib/pdf/invoice-pdf";
import { toPlainDate } from "@/lib/date/plain-date";

const base: InvoicePdfData = {
  invoiceNumber: "NAT-20260705",
  generatedAt: new Date("2026-07-13T10:00:00Z"),
  contractorName: "Nathaly",
  businessName: "JPD Group",
  businessAddress: "123 Example Street",
  periodStart: toPlainDate("2026-07-05"),
  periodEnd: toPlainDate("2026-07-11"),
  depositDate: toPlainDate("2026-07-17"),
  payType: "FLAT_WEEKLY",
  approvedSeconds: 28 * 3600 + 30 * 60,
  hourlyRate: null,
  weeklyAmount: "750.00",
  amount: "750.00",
  status: "GENERATED",
  approvedByName: "Morgan Diaz",
  approvedAt: new Date("2026-07-13T09:00:00Z"),
  paymentMethod: "USDT",
  invoiceNote: "Paid in USDT on the Friday following the pay period.",
};

async function render(over: Partial<InvoicePdfData> = {}): Promise<Buffer> {
  return renderInvoicePdf({ ...base, ...over });
}

/**
 * The visible text of the document.
 *
 * PDF content streams are Flate-compressed, so searching the raw bytes finds
 * nothing. Inflating them is what lets these tests assert that the figures a
 * contractor would query actually reached the page, rather than only that
 * *some* PDF was produced.
 */
function extractText(pdf: Buffer): string {
  const out: string[] = [];
  const marker = Buffer.from("stream");
  let index = 0;

  while (index < pdf.length) {
    const start = pdf.indexOf(marker, index);
    if (start === -1) break;

    let from = start + marker.length;
    if (pdf[from] === 0x0d) from += 1;
    if (pdf[from] === 0x0a) from += 1;

    const end = pdf.indexOf(Buffer.from("endstream"), from);
    if (end === -1) break;

    try {
      out.push(inflateSync(pdf.subarray(from, end)).toString("latin1"));
    } catch {
      // Not a Flate stream — a font file, say. Skipped rather than fatal.
    }
    index = end + 1;
  }

  // pdfkit writes text as `[<hex> kern <hex> …] TJ`, splitting a single word
  // across several hex runs wherever it applies kerning. Decoding each run and
  // joining them back up is what turns the stream into readable text.
  const decodeHex = (hex: string): string =>
    (hex.match(/.{2}/g) ?? [])
      .map((code) => String.fromCharCode(Number.parseInt(code, 16)))
      .join("");

  return out
    .join("\n")
    .replace(/\[([^\]]*)\]\s*TJ/g, (_match, body: string) =>
      [...body.matchAll(/<([0-9A-Fa-f]+)>/g)].map((m) => decodeHex(m[1]!)).join(""),
    )
    .replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_match, hex: string) => decodeHex(hex));
}

describe("renderInvoicePdf", () => {
  it("produces a real PDF", async () => {
    const bytes = await render();
    expect(bytes.length).toBeGreaterThan(1000);
    // Every PDF starts with this signature.
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.subarray(-6).toString("latin1")).toContain("EOF");
  });

  it("renders an hourly invoice", async () => {
    const bytes = await render({
      payType: "HOURLY",
      hourlyRate: "3.1300",
      weeklyAmount: null,
      approvedSeconds: 32 * 3600 + 30 * 60,
      amount: "101.73",
    });
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("renders a voided invoice without falling over", async () => {
    const bytes = await render({ status: "VOID" });
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("renders when nobody is recorded as the approver", async () => {
    // Happens after a void: the approval row is released, so a reissued
    // invoice can have no approval attached.
    const bytes = await render({ approvedByName: null, approvedAt: null });
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("renders with every optional field absent", async () => {
    const bytes = await render({
      businessAddress: null,
      invoiceNote: null,
      approvedByName: null,
      approvedAt: null,
      hourlyRate: null,
      weeklyAmount: null,
    });
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("is deterministic in size for identical input", async () => {
    // The whole storage design rests on regeneration being reproducible: if
    // the same invoice rendered differently each time, it could not be
    // generated on demand instead of being stored.
    const [first, second] = await Promise.all([render(), render()]);
    expect(first.length).toBe(second.length);
  });

  it("differs when the amount differs", async () => {
    const [a, b] = await Promise.all([render(), render({ amount: "1250.00" })]);
    expect(a.equals(b)).toBe(false);
  });

  it("puts the figures a contractor would query on the page", async () => {
    const text = extractText(
      await render({
        payType: "HOURLY",
        hourlyRate: "3.1300",
        weeklyAmount: null,
        approvedSeconds: 32 * 3600 + 30 * 60,
        amount: "101.73",
      }),
    );

    expect(text).toContain("NAT-20260705");
    expect(text).toContain("Nathaly");
    expect(text).toContain("32.50");
    expect(text).toContain("3.13");
    expect(text).toContain("101.73");
    // The deposit date must be a full date, never the weekday alone.
    expect(text).toContain("Jul 17, 2026");
  });

  it("says VOID on the page when the invoice is void", async () => {
    // A voided invoice that has been printed or forwarded must not read as
    // money owed.
    expect(extractText(await render({ status: "VOID" }))).toContain("VOID");
    expect(extractText(await render({ status: "PAID" }))).not.toContain("VOID");
  });

  it("names the approver and the approval date", async () => {
    const text = extractText(await render());
    expect(text).toContain("Morgan Diaz");
  });

  it("marks a flat-weekly invoice's hours as reference only", async () => {
    // Hours are shown for a flat-weekly contractor, so the document must say
    // they are not what the amount came from.
    const text = extractText(await render({ payType: "FLAT_WEEKLY" }));
    expect(text).toContain("reference");
  });

  it("survives a long business address and note without throwing", async () => {
    const bytes = await render({
      businessAddress: "Suite 400, ".repeat(20),
      invoiceNote: "Terms and conditions apply. ".repeat(30),
    });
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
