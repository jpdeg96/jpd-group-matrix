import { describe, expect, it } from "vitest";
import { Decimal } from "@prisma/client/runtime/library";
import { toPlainDate, type PlainDate } from "@/lib/date/plain-date";
import {
  AMOUNT_CONFIRMATION_THRESHOLD,
  calculatePay,
  canGenerateInvoice,
  canRefreshFromImport,
  depositDateFor,
  formatHours,
  hoursFromSeconds,
  InvalidInvoicePrefixError,
  invoiceNumberFor,
  parseInvoiceNumber,
  payPeriodContaining,
  priorPayPeriod,
  roundMoney,
  suggestInvoicePrefix,
  validateInvoiceDraft,
} from "@/lib/domain/payroll";
import { formatHours as formatHoursClient } from "@/lib/domain/payroll-format";

const d = (value: string): PlainDate => toPlainDate(value);
const hours = (h: number) => Math.round(h * 3600);

describe("the pay week", () => {
  it("runs Sunday to Saturday", () => {
    // 2026-07-08 is a Wednesday.
    const period = payPeriodContaining(d("2026-07-08"));
    expect(period.start).toBe("2026-07-05");
    expect(period.end).toBe("2026-07-11");
  });

  it("matches the brief's worked example", () => {
    const period = payPeriodContaining(d("2026-07-05"));
    expect(period.start).toBe("2026-07-05");
    expect(period.end).toBe("2026-07-11");
    expect(period.depositDate).toBe("2026-07-17");
  });

  it("keeps Sunday at the start of its own week", () => {
    expect(payPeriodContaining(d("2026-07-05")).start).toBe("2026-07-05");
  });

  it("keeps Saturday at the end of the week that began the previous Sunday", () => {
    expect(payPeriodContaining(d("2026-07-11")).start).toBe("2026-07-05");
  });

  it("deposits on the Friday after the week closes", () => {
    expect(depositDateFor(d("2026-07-11"))).toBe("2026-07-17");
  });

  it("crosses a month end without drifting", () => {
    const period = payPeriodContaining(d("2026-07-30"));
    expect(period.start).toBe("2026-07-26");
    expect(period.end).toBe("2026-08-01");
    expect(period.depositDate).toBe("2026-08-07");
  });

  it("crosses a year end without drifting", () => {
    const period = payPeriodContaining(d("2026-12-31"));
    expect(period.start).toBe("2026-12-27");
    expect(period.end).toBe("2027-01-02");
    expect(period.depositDate).toBe("2027-01-08");
  });

  describe("priorPayPeriod", () => {
    it("is the week before, which is what Monday imports", () => {
      // Monday 2026-07-13 -> the week of Sunday 2026-07-05.
      const period = priorPayPeriod(d("2026-07-13"));
      expect(period.start).toBe("2026-07-05");
      expect(period.end).toBe("2026-07-11");
    });

    it("is still the previous week when run on a Sunday", () => {
      const period = priorPayPeriod(d("2026-07-12"));
      expect(period.start).toBe("2026-07-05");
    });

    it("is still the previous week when run on a Saturday", () => {
      const period = priorPayPeriod(d("2026-07-18"));
      expect(period.start).toBe("2026-07-05");
    });
  });
});

describe("money", () => {
  it("rounds the brief's example the way the brief says", () => {
    // 32.50 x 3.13 = 101.725. This is the case where JavaScript's two obvious
    // rounding routes disagree; the expected answer is 101.73.
    const pay = calculatePay({
      payType: "HOURLY",
      seconds: hours(32.5),
      weeklyAmount: null,
      hourlyRate: new Decimal("3.13"),
    });
    expect(pay.toFixed(2)).toBe("101.73");
  });

  it("rounds half up, not half to even", () => {
    expect(roundMoney(new Decimal("0.125")).toFixed(2)).toBe("0.13");
    expect(roundMoney(new Decimal("0.135")).toFixed(2)).toBe("0.14");
  });

  it("does not drift when many entries are summed", () => {
    // Seven days of 7h 20m. Summing seconds and rounding once cannot drift;
    // rounding each day to hours first and then adding would.
    const perDay = 7 * 3600 + 20 * 60;
    const total = perDay * 7;
    expect(hoursFromSeconds(total).toFixed(2)).toBe("51.33");
  });

  it("bills the hours it prints, so an invoice adds up by hand", () => {
    // 149,371 seconds is 41.491944… hours. Billing the unrounded figure gives
    // 129.87 while the 41.49 on the invoice gives 129.86 — a contractor
    // checking their own invoice would find it wrong. Real numbers, from a
    // real Clockify week.
    const seconds = 149_371;
    const shownHours = hoursFromSeconds(seconds);
    expect(shownHours.toFixed(2)).toBe("41.49");

    const pay = calculatePay({
      payType: "HOURLY",
      seconds,
      weeklyAmount: null,
      hourlyRate: new Decimal("3.13"),
    });

    expect(pay.toFixed(2)).toBe("129.86");
    // The invoice line must be self-checking.
    expect(pay.toFixed(2)).toBe(
      roundMoney(new Decimal(shownHours.toFixed(2)).times("3.13")).toFixed(2),
    );
  });

  it("presents hours to two places", () => {
    expect(formatHours(hours(32.5))).toBe("32.50");
    expect(formatHours(0)).toBe("0.00");
  });
});

describe("calculatePay", () => {
  it("pays a flat-weekly contractor their weekly amount", () => {
    const pay = calculatePay({
      payType: "FLAT_WEEKLY",
      seconds: hours(28.5),
      weeklyAmount: new Decimal("750.00"),
      hourlyRate: null,
    });
    expect(pay.toFixed(2)).toBe("750.00");
  });

  it("ignores hours entirely for flat weekly, however many there are", () => {
    const base = { payType: "FLAT_WEEKLY" as const, weeklyAmount: new Decimal("750"), hourlyRate: null };
    expect(calculatePay({ ...base, seconds: 0 }).toFixed(2)).toBe("750.00");
    expect(calculatePay({ ...base, seconds: hours(80) }).toFixed(2)).toBe("750.00");
  });

  it("pays an hourly contractor for approved hours", () => {
    const pay = calculatePay({
      payType: "HOURLY",
      seconds: hours(40),
      weeklyAmount: null,
      hourlyRate: new Decimal("3.13"),
    });
    expect(pay.toFixed(2)).toBe("125.20");
  });

  it("pays an hourly contractor nothing for no hours", () => {
    const pay = calculatePay({
      payType: "HOURLY",
      seconds: 0,
      weeklyAmount: null,
      hourlyRate: new Decimal("3.13"),
    });
    expect(pay.toFixed(2)).toBe("0.00");
  });

  it("handles part-hours to the minute", () => {
    // 32h 30m at 3.13 is the same as 32.5 hours.
    const pay = calculatePay({
      payType: "HOURLY",
      seconds: 32 * 3600 + 30 * 60,
      weeklyAmount: null,
      hourlyRate: new Decimal("3.13"),
    });
    expect(pay.toFixed(2)).toBe("101.73");
  });

  it("treats a missing rate as zero rather than throwing mid-run", () => {
    // A contractor without their rate is a data problem the validator catches;
    // the arithmetic must not explode partway through a payroll run.
    expect(
      calculatePay({ payType: "HOURLY", seconds: hours(10), weeklyAmount: null, hourlyRate: null }).toFixed(2),
    ).toBe("0.00");
    expect(
      calculatePay({ payType: "FLAT_WEEKLY", seconds: 0, weeklyAmount: null, hourlyRate: null }).toFixed(2),
    ).toBe("0.00");
  });
});

describe("invoice numbers", () => {
  it("is the prefix and the Sunday the week opened", () => {
    expect(invoiceNumberFor("NAT", d("2026-07-05"))).toBe("NAT-20260705");
    expect(invoiceNumberFor("NES", d("2026-07-05"))).toBe("NES-20260705");
    expect(invoiceNumberFor("TOR", d("2026-07-05"))).toBe("TOR-20260705");
  });

  it("normalises case and surrounding space", () => {
    expect(invoiceNumberFor("  nat ", d("2026-07-05"))).toBe("NAT-20260705");
  });

  it("is stable for the same week and revision", () => {
    expect(invoiceNumberFor("NAT", d("2026-07-05"))).toBe(
      invoiceNumberFor("NAT", d("2026-07-05")),
    );
  });

  it("suffixes a reissue rather than reusing a voided number", () => {
    // A voided invoice is still a document that existed. Two documents sharing
    // an identifier defeats the point of having one.
    expect(invoiceNumberFor("NAT", d("2026-07-05"), 2)).toBe("NAT-20260705-R2");
    expect(invoiceNumberFor("NAT", d("2026-07-05"), 3)).toBe("NAT-20260705-R3");
    expect(invoiceNumberFor("NAT", d("2026-07-05"), 10)).toBe("NAT-20260705-R10");
  });

  it("rejects a nonsense revision", () => {
    expect(() => invoiceNumberFor("NAT", d("2026-07-05"), 0)).toThrow();
    expect(() => invoiceNumberFor("NAT", d("2026-07-05"), -1)).toThrow();
    expect(() => invoiceNumberFor("NAT", d("2026-07-05"), 1.5)).toThrow();
  });

  it("rejects a prefix that would produce an unparseable number", () => {
    expect(() => invoiceNumberFor("", d("2026-07-05"))).toThrow(InvalidInvoicePrefixError);
    expect(() => invoiceNumberFor("N", d("2026-07-05"))).toThrow(InvalidInvoicePrefixError);
    expect(() => invoiceNumberFor("NAT-X", d("2026-07-05"))).toThrow(InvalidInvoicePrefixError);
    expect(() => invoiceNumberFor("TOOLONGAPREFIX", d("2026-07-05"))).toThrow();
  });

  it("round-trips", () => {
    expect(parseInvoiceNumber("NAT-20260705")).toEqual({
      prefix: "NAT",
      periodStart: "2026-07-05",
      revision: 1,
    });
    expect(parseInvoiceNumber("NAT-20260705-R2")).toEqual({
      prefix: "NAT",
      periodStart: "2026-07-05",
      revision: 2,
    });
  });

  it("refuses malformed numbers rather than guessing", () => {
    expect(parseInvoiceNumber("NAT")).toBeNull();
    expect(parseInvoiceNumber("NAT-2026070")).toBeNull();
    expect(parseInvoiceNumber("nat-20260705")).toBeNull();
    // A real date is required: there is no 45th of July.
    expect(parseInvoiceNumber("NAT-20260745")).toBeNull();
  });
});

describe("the two formatHours implementations", () => {
  it("agree, so a week never reads differently on the server and in the browser", () => {
    // There are two on purpose: the decimal one cannot go in the browser
    // bundle (it drags Prisma's Node runtime in and the build fails), so the
    // client has a float twin. This is what stops them drifting apart.
    const cases = [
      0, 1, 59, 60, 3599, 3600, 3601,
      32 * 3600 + 30 * 60,
      7 * (7 * 3600 + 20 * 60),
      40 * 3600,
      1_000_000,
    ];

    for (const seconds of cases) {
      expect(formatHoursClient(seconds)).toBe(formatHours(seconds));
    }
  });
});

describe("suggestInvoicePrefix", () => {
  it("reproduces the brief's own three contractors, in order", () => {
    // The interesting one is Nestor: NES is already Nesterly's, and a human
    // reached for TOR rather than NES2. Falling back to the *last* three
    // letters gets there on its own.
    const taken: string[] = [];
    const nathaly = suggestInvoicePrefix("Nathaly", taken);
    taken.push(nathaly);
    const nesterly = suggestInvoicePrefix("Nesterly", taken);
    taken.push(nesterly);
    const nestor = suggestInvoicePrefix("Nestor", taken);

    expect(nathaly).toBe("NAT");
    expect(nesterly).toBe("NES");
    expect(nestor).toBe("TOR");
  });

  it("handles the fourth name without a collision", () => {
    expect(suggestInvoicePrefix("Stephanie", ["NAT", "NES", "TOR"])).toBe("STE");
  });

  it("takes the first three letters when nothing is taken", () => {
    expect(suggestInvoicePrefix("Nathaly", [])).toBe("NAT");
  });

  it("ignores spaces, punctuation and case", () => {
    expect(suggestInvoicePrefix("  o'brien-smith ", [])).toBe("OBR");
  });

  it("numbers only once both the head and the tail are taken", () => {
    expect(suggestInvoicePrefix("Nestor", ["NES", "TOR"])).toBe("NES2");
    expect(suggestInvoicePrefix("Nestor", ["NES", "TOR", "NES2"])).toBe("NES3");
  });

  it("compares case-insensitively against what is already taken", () => {
    expect(suggestInvoicePrefix("Nathaly", ["nat"])).not.toBe("NAT");
  });

  it("always returns something the database will accept", () => {
    const pattern = /^[A-Z0-9]{2,10}$/;
    for (const name of ["Al", "X", "", "   ", "123", "Zoë", "Jean-Luc Picard"]) {
      expect(suggestInvoicePrefix(name, [])).toMatch(pattern);
    }
  });

  it("never suggests a prefix that is already in use", () => {
    const taken = new Set<string>();
    for (const name of ["Nathaly", "Nesterly", "Nestor", "Nate", "Nathan", "Nat"]) {
      const prefix = suggestInvoicePrefix(name, taken);
      expect(taken.has(prefix)).toBe(false);
      taken.add(prefix);
    }
    expect(taken.size).toBe(6);
  });
});

describe("validateInvoiceDraft", () => {
  const valid = {
    invoiceNumber: "NAT-20260705",
    contractorName: "Nathaly",
    periodStart: d("2026-07-05"),
    periodEnd: d("2026-07-11"),
    payType: "FLAT_WEEKLY" as const,
    amount: new Decimal("750.00"),
  };

  it("passes a good draft", () => {
    expect(validateInvoiceDraft(valid)).toEqual([]);
  });

  it("catches the failures the spreadsheet actually produced", () => {
    // Every one of these is a real corruption from the Apps Script version.
    expect(validateInvoiceDraft({ ...valid, invoiceNumber: "" })[0]).toContain("blank");
    expect(validateInvoiceDraft({ ...valid, contractorName: "  " })[0]).toContain("blank");

    const ancient = validateInvoiceDraft({
      ...valid,
      periodStart: d("1969-12-31"),
      periodEnd: d("1970-01-06"),
    });
    expect(ancient.some((p) => p.includes("outside"))).toBe(true);

    const huge = validateInvoiceDraft({ ...valid, amount: new Decimal("1786588530892") });
    expect(huge.some((p) => p.includes("threshold"))).toBe(true);
  });

  it("catches a negative amount", () => {
    const problems = validateInvoiceDraft({ ...valid, amount: new Decimal("-1") });
    expect(problems.some((p) => p.includes("negative"))).toBe(true);
  });

  it("allows an amount exactly at the threshold", () => {
    expect(
      validateInvoiceDraft({ ...valid, amount: AMOUNT_CONFIRMATION_THRESHOLD }),
    ).toEqual([]);
  });

  it("catches a period that starts after it ends", () => {
    const problems = validateInvoiceDraft({
      ...valid,
      periodStart: d("2026-07-11"),
      periodEnd: d("2026-07-05"),
    });
    expect(problems.some((p) => p.includes("starts after"))).toBe(true);
  });

  it("reports every problem at once, not just the first", () => {
    const problems = validateInvoiceDraft({
      ...valid,
      invoiceNumber: "",
      contractorName: "",
      amount: new Decimal("-5"),
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe("safeguards", () => {
  it("only lets an approved, uninvoiced row become an invoice", () => {
    expect(canGenerateInvoice({ managerStatus: "APPROVED", invoiceId: null })).toBe(true);
    expect(canGenerateInvoice({ managerStatus: "APPROVED", invoiceId: "inv-1" })).toBe(false);
    expect(canGenerateInvoice({ managerStatus: "PENDING", invoiceId: null })).toBe(false);
    expect(canGenerateInvoice({ managerStatus: "REJECTED", invoiceId: null })).toBe(false);
    expect(canGenerateInvoice({ managerStatus: "NEEDS_REVIEW", invoiceId: null })).toBe(false);
  });

  it("lets a re-import refresh only rows nobody has committed to", () => {
    expect(canRefreshFromImport({ managerStatus: "PENDING", invoiceId: null })).toBe(true);
    expect(canRefreshFromImport({ managerStatus: "NEEDS_REVIEW", invoiceId: null })).toBe(true);
  });

  it("refuses to restate an approved week", () => {
    expect(canRefreshFromImport({ managerStatus: "APPROVED", invoiceId: null })).toBe(false);
  });

  it("refuses to restate an invoiced week even if it were somehow pending", () => {
    expect(canRefreshFromImport({ managerStatus: "PENDING", invoiceId: "inv-1" })).toBe(false);
  });

  it("leaves a rejected row alone", () => {
    // Rejection is a decision. A re-import must not quietly undo it.
    expect(canRefreshFromImport({ managerStatus: "REJECTED", invoiceId: null })).toBe(false);
  });
});
