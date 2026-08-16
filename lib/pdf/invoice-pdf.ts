/**
 * Invoice PDFs.
 *
 * Generated on demand from the invoice row rather than stored as bytes. The
 * row already snapshots pay type, hours, rate and amount at the moment it was
 * issued, so regenerating always produces the same document — which means
 * there is nothing to keep in a bucket, nothing to back up separately, and no
 * way for a stored file to drift out of step with the record it describes.
 *
 * The trade is that changing this template restyles historical invoices. For
 * an internal system that is fine: the copy a contractor was sent is already
 * fixed in their inbox, and what matters here is that the *figures* cannot
 * change, which they cannot.
 */

import PDFDocument from "pdfkit";
import type { PlainDate } from "@/lib/date/plain-date";
import { formatPlainDate } from "@/lib/date/plain-date";
import { formatHours, formatMoney, formatRate, PAY_TYPE_LABELS } from "@/lib/domain/payroll-format";
import type { PayType } from "@/lib/domain/payroll-format";

export interface InvoicePdfData {
  invoiceNumber: string;
  generatedAt: Date;
  contractorName: string;
  businessName: string;
  businessAddress: string | null;
  periodStart: PlainDate;
  periodEnd: PlainDate;
  depositDate: PlainDate;
  /** Null on a manual invoice, which has no hours behind it. */
  payType: PayType | null;
  /** What a manual invoice is for. Replaces the pay-type line item. */
  description: string | null;
  approvedSeconds: number;
  hourlyRate: string | null;
  weeklyAmount: string | null;
  amount: string;
  status: string;
  approvedByName: string | null;
  approvedAt: Date | null;
  paymentMethod: string;
  invoiceNote: string | null;
}

const MARGIN = 50;
const INK = "#111827";
const MUTED = "#6b7280";
const LINE = "#e5e7eb";

/** Renders the invoice and resolves once the whole document is in memory. */
export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: MARGIN });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      draw(doc, data);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function draw(doc: PDFKit.PDFDocument, data: InvoicePdfData): void {
  const right = doc.page.width - MARGIN;
  const width = right - MARGIN;

  // ---- Header -------------------------------------------------------------
  doc.fillColor(INK).fontSize(22).font("Helvetica-Bold").text("INVOICE", MARGIN, MARGIN);

  doc
    .fontSize(11)
    .font("Helvetica")
    .fillColor(MUTED)
    .text(data.invoiceNumber, MARGIN, MARGIN + 28);

  doc
    .fontSize(10)
    .text(`Issued ${formatPlainDate(isoDate(data.generatedAt))}`, MARGIN, MARGIN, {
      width,
      align: "right",
    });

  // A voided invoice must never be mistaken for one that is owed, including
  // when it has been printed or forwarded on.
  if (data.status === "VOID") {
    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .fillColor("#dc2626")
      .text("VOID", MARGIN, MARGIN + 16, { width, align: "right" });
  }

  let y = MARGIN + 62;
  rule(doc, y);
  y += 18;

  // ---- Parties ------------------------------------------------------------
  const columnWidth = width / 2 - 10;

  doc.fontSize(9).font("Helvetica-Bold").fillColor(MUTED).text("FROM", MARGIN, y);
  doc.text("BILL TO", MARGIN + columnWidth + 20, y);

  doc.fontSize(12).font("Helvetica-Bold").fillColor(INK).text(data.contractorName, MARGIN, y + 14);
  doc.text(data.businessName, MARGIN + columnWidth + 20, y + 14);

  if (data.businessAddress) {
    doc
      .fontSize(9.5)
      .font("Helvetica")
      .fillColor(MUTED)
      .text(data.businessAddress, MARGIN + columnWidth + 20, y + 30, { width: columnWidth });
  }

  y += 64;

  // ---- Period -------------------------------------------------------------
  doc.fontSize(9).font("Helvetica-Bold").fillColor(MUTED).text("PAY PERIOD", MARGIN, y);
  doc.text("DEPOSIT DATE", MARGIN + columnWidth + 20, y);

  doc
    .fontSize(11)
    .font("Helvetica")
    .fillColor(INK)
    .text(
      `${formatPlainDate(data.periodStart)} — ${formatPlainDate(data.periodEnd)}`,
      MARGIN,
      y + 14,
    );

  // The full date, never the weekday alone: this is the promise about when
  // money arrives, and "Friday" is the ambiguity that makes people ask.
  doc.text(formatPlainDate(data.depositDate), MARGIN + columnWidth + 20, y + 14);

  y += 48;
  rule(doc, y);
  y += 14;

  // ---- Line item ----------------------------------------------------------
  const columns = { desc: MARGIN, qty: MARGIN + 300, rate: MARGIN + 380, amount: right - 80 };

  doc.fontSize(9).font("Helvetica-Bold").fillColor(MUTED);
  doc.text("DESCRIPTION", columns.desc, y);
  doc.text("HOURS", columns.qty, y, { width: 60, align: "right" });
  doc.text("RATE", columns.rate, y, { width: 70, align: "right" });
  doc.text("AMOUNT", columns.amount, y, { width: 80, align: "right" });

  y += 18;
  rule(doc, y);
  y += 12;

  const manual = data.payType === null;
  const hourly = data.payType === "HOURLY";

  doc.fontSize(10.5).font("Helvetica").fillColor(INK);
  doc.text(
    // A manual invoice states its own reason. Nothing derived its amount, so
    // there is no pay type to name and no week of work to attribute it to.
    manual
      ? (data.description ?? "Adjustment")
      : `${PAY_TYPE_LABELS[data.payType!]} — week of ${formatPlainDate(data.periodStart)}`,
    columns.desc,
    y,
    { width: 290 },
  );
  doc.text(
    manual ? "—" : formatHours(data.approvedSeconds),
    columns.qty,
    y,
    { width: 60, align: "right" },
  );
  doc.text(
    hourly ? `$${formatRate(data.hourlyRate ?? "0")}` : "—",
    columns.rate,
    y,
    { width: 70, align: "right" },
  );
  doc.text(`$${formatMoney(data.amount)}`, columns.amount, y, { width: 80, align: "right" });

  // Hours are shown for a flat-weekly contractor too, but must not read as
  // something the amount was derived from. A manual invoice shows none at all,
  // so it needs no such disclaimer.
  if (!hourly && !manual) {
    y += 15;
    doc
      .fontSize(9)
      .fillColor(MUTED)
      .text("Hours recorded for reference; pay is a fixed weekly amount.", columns.desc, y, {
        width: 290,
      });
  }

  y += 26;
  rule(doc, y);
  y += 14;

  // ---- Total --------------------------------------------------------------
  doc.fontSize(11).font("Helvetica-Bold").fillColor(MUTED).text("AMOUNT DUE", columns.rate - 40, y, {
    width: 110,
    align: "right",
  });
  doc
    .fontSize(15)
    .fillColor(INK)
    .text(`$${formatMoney(data.amount)}`, columns.amount, y - 3, { width: 80, align: "right" });

  y += 40;

  // ---- Approval trail -----------------------------------------------------
  doc.fontSize(9).font("Helvetica-Bold").fillColor(MUTED).text("APPROVAL", MARGIN, y);
  y += 14;

  doc.fontSize(9.5).font("Helvetica").fillColor(INK);
  doc.text(
    data.approvedAt
      ? `Approved by ${data.approvedByName ?? "a manager"} on ${formatPlainDate(isoDate(data.approvedAt))}`
      : "Not yet approved",
    MARGIN,
    y,
  );
  y += 14;
  doc.text(`Approved Clockify hours: ${formatHours(data.approvedSeconds)}`, MARGIN, y);
  y += 14;
  doc.text(`Payment method: ${data.paymentMethod}`, MARGIN, y);

  // ---- Footer -------------------------------------------------------------
  if (data.invoiceNote) {
    const footerY = doc.page.height - MARGIN - 40;
    rule(doc, footerY - 12);
    doc
      .fontSize(9)
      .fillColor(MUTED)
      .text(data.invoiceNote, MARGIN, footerY, { width });
  }
}

function rule(doc: PDFKit.PDFDocument, y: number): void {
  doc
    .strokeColor(LINE)
    .lineWidth(1)
    .moveTo(MARGIN, y)
    .lineTo(doc.page.width - MARGIN, y)
    .stroke();
}

/** `Date` → the `YYYY-MM-DD` the formatter expects. */
function isoDate(value: Date): PlainDate {
  return value.toISOString().slice(0, 10) as PlainDate;
}
