import { describe, expect, it } from "vitest";
import { adminSummaryEmail, contractorEmail } from "@/lib/services/remittance";
import { toPlainDate } from "@/lib/date/plain-date";

const base = {
  contractorName: "Nathaly",
  businessName: "JPD Group",
  invoiceNumber: "NAT-20260705",
  periodStart: toPlainDate("2026-07-05"),
  periodEnd: toPlainDate("2026-07-11"),
  depositDate: toPlainDate("2026-07-17"),
  payType: "FLAT_WEEKLY" as const,
  approvedSeconds: 28 * 3600 + 30 * 60,
  amount: "750.00",
  paymentMethod: "USDT",
  footerNote: "Questions? Reply to this email.",
};

describe("the contractor email", () => {
  it("gives the deposit date in full, never just the weekday", () => {
    // The brief calls this out specifically: "Friday" alone is the ambiguity
    // that makes somebody ask when they are getting paid.
    const { html, text } = contractorEmail(base);
    expect(text).toContain("Jul 17, 2026");
    expect(html).toContain("Jul 17, 2026");
    expect(text).not.toMatch(/deposit date:\s*Friday\s*$/im);
  });

  it("carries everything the brief asks for", () => {
    const { text } = contractorEmail(base);
    for (const expected of [
      "Nathaly",
      "Jul 5, 2026",
      "Jul 11, 2026",
      "Jul 17, 2026",
      "USDT",
      "28.50",
      "Flat weekly",
      "$750.00",
      "NAT-20260705",
      "Questions? Reply to this email.",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("mentions the attached invoice", () => {
    expect(contractorEmail(base).text).toContain("attached");
  });

  it("works without a footer note", () => {
    const { html, text } = contractorEmail({ ...base, footerNote: null });
    expect(text).toContain("NAT-20260705");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });

  it("describes an hourly contractor as hourly", () => {
    const { text } = contractorEmail({
      ...base,
      payType: "HOURLY",
      approvedSeconds: 32 * 3600 + 30 * 60,
      amount: "101.73",
    });
    expect(text).toContain("Hourly");
    expect(text).toContain("32.50");
    expect(text).toContain("$101.73");
  });

  it("escapes anything that would otherwise inject markup", () => {
    // A contractor name is data, and it lands inside an HTML email.
    const { html } = contractorEmail({
      ...base,
      contractorName: '<script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("the admin summary", () => {
  const summary = {
    businessName: "JPD Group",
    periodStart: toPlainDate("2026-07-05"),
    periodEnd: toPlainDate("2026-07-11"),
    depositDate: toPlainDate("2026-07-17"),
    rows: [
      {
        contractorName: "Nathaly",
        invoiceNumber: "NAT-20260705",
        payType: "FLAT_WEEKLY" as const,
        approvedSeconds: 28 * 3600,
        amount: "750.00",
        status: "GENERATED",
      },
      {
        contractorName: "Nestor",
        invoiceNumber: "TOR-20260705",
        payType: "HOURLY" as const,
        approvedSeconds: 32 * 3600 + 30 * 60,
        amount: "101.73",
        status: "GENERATED",
      },
    ],
    total: "851.73",
    sent: 2,
    skipped: 0,
    failed: 0,
  };

  it("lists every contractor with their invoice and amount", () => {
    const { text } = adminSummaryEmail(summary);
    expect(text).toContain("Nathaly");
    expect(text).toContain("NAT-20260705");
    expect(text).toContain("$750.00");
    expect(text).toContain("Nestor");
    expect(text).toContain("TOR-20260705");
    expect(text).toContain("$101.73");
  });

  it("has a total at the bottom, as the brief asks", () => {
    const { html, text } = adminSummaryEmail(summary);
    expect(text).toContain("TOTAL: $851.73");
    expect(html).toContain("851.73");
    // The total must come after the rows, not before them.
    expect(text.indexOf("TOTAL")).toBeGreaterThan(text.indexOf("Nestor"));
  });

  it("reports what actually happened, including failures", () => {
    const { text } = adminSummaryEmail({ ...summary, sent: 1, skipped: 1, failed: 1 });
    expect(text).toContain("sent: 1");
    expect(text).toContain("skipped: 1");
    expect(text).toContain("failed: 1");
  });

  it("handles a period with no invoices", () => {
    const { text } = adminSummaryEmail({ ...summary, rows: [], total: "0.00", sent: 0 });
    expect(text).toContain("TOTAL: $0.00");
  });

  it("escapes contractor names in the table", () => {
    const { html } = adminSummaryEmail({
      ...summary,
      rows: [{ ...summary.rows[0]!, contractorName: "<b>bold</b>" }],
    });
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;");
  });
});
