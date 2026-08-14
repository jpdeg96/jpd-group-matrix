/**
 * Paging in the Clockify time-entry reader.
 *
 * This matters because the failure mode is silent. A single request returns at
 * most `page-size` rows, so before paging existed a month or a year of entries
 * came back truncated — and truncated hours look perfectly plausible. Nothing
 * errors, no row is obviously missing; the totals are just quietly too low.
 *
 * `fetch` is stubbed rather than hit, so this stays fast and needs no account.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTimeEntries } from "@/lib/clockify/client";

const WORKSPACE = "ws-1";
const USER = "cu-1";

const start = new Date("2026-01-01T00:00:00.000Z");
const end = new Date("2026-08-14T00:00:00.000Z");

function entry(id: number) {
  return {
    id: `entry-${id}`,
    description: "",
    timeInterval: { start: start.toISOString(), end: end.toISOString(), duration: "PT1H" },
  };
}

/** A stub holding `total` entries, served in pages of whatever is asked for. */
function stubWithEntries(total: number) {
  const requested: { page: number; pageSize: number }[] = [];

  vi.stubGlobal("fetch", async (url: string) => {
    const params = new URL(url).searchParams;
    const page = Number(params.get("page"));
    const pageSize = Number(params.get("page-size"));
    requested.push({ page, pageSize });

    const from = (page - 1) * pageSize;
    const rows = Array.from({ length: Math.max(Math.min(pageSize, total - from), 0) }, (_, i) =>
      entry(from + i),
    );

    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  return requested;
}

beforeEach(() => {
  process.env.CLOCKIFY_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getTimeEntries paging", () => {
  it("returns everything when it spans several pages", async () => {
    const requested = stubWithEntries(475);

    const rows = await getTimeEntries(WORKSPACE, USER, { start, end, pageSize: 200 });

    expect(rows).toHaveLength(475);
    expect(requested.map((r) => r.page)).toEqual([1, 2, 3]);
  });

  it("returns no duplicates across pages", async () => {
    stubWithEntries(475);
    const rows = await getTimeEntries(WORKSPACE, USER, { start, end, pageSize: 200 });
    expect(new Set(rows.map((r) => r.id)).size).toBe(475);
  });

  it("agrees with itself whatever the page size", async () => {
    stubWithEntries(475);
    const big = await getTimeEntries(WORKSPACE, USER, { start, end, pageSize: 500 });

    // maxPages has to allow for the smaller pages, or the cap truncates and
    // the two disagree — which is the cap working, not paging failing.
    stubWithEntries(475);
    const small = await getTimeEntries(WORKSPACE, USER, {
      start,
      end,
      pageSize: 5,
      maxPages: 100,
    });

    expect(small.map((r) => r.id)).toEqual(big.map((r) => r.id));
  });

  it("warns rather than truncating silently when the cap is reached", async () => {
    // A short total that nothing complains about is exactly the bug paging was
    // added to fix, so the ceiling must not reintroduce it quietly.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubWithEntries(1_000);

    await getTimeEntries(WORKSPACE, USER, { start, end, pageSize: 10, maxPages: 3 });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("understated");
    warn.mockRestore();
  });

  it("does not warn when the range fits", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubWithEntries(40);

    await getTimeEntries(WORKSPACE, USER, { start, end, pageSize: 200 });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stops after one request when the first page is short", async () => {
    // The common case. Paging must not cost an extra round trip per call.
    const requested = stubWithEntries(40);
    const rows = await getTimeEntries(WORKSPACE, USER, { start, end, pageSize: 200 });

    expect(rows).toHaveLength(40);
    expect(requested).toHaveLength(1);
  });

  it("stops on an exactly-full final page rather than looping", async () => {
    // 400 in pages of 200 means page 3 comes back empty; that empty page is
    // what ends it, and it must not be mistaken for more data.
    const requested = stubWithEntries(400);
    const rows = await getTimeEntries(WORKSPACE, USER, { start, end, pageSize: 200 });

    expect(rows).toHaveLength(400);
    expect(requested.map((r) => r.page)).toEqual([1, 2, 3]);
  });

  it("honours the page cap so a mistaken range cannot request forever", async () => {
    const requested = stubWithEntries(1_000_000);

    const rows = await getTimeEntries(WORKSPACE, USER, {
      start,
      end,
      pageSize: 10,
      maxPages: 4,
    });

    expect(requested).toHaveLength(4);
    expect(rows).toHaveLength(40);
  });

  it("returns nothing for a range with no entries", async () => {
    stubWithEntries(0);
    expect(await getTimeEntries(WORKSPACE, USER, { start, end })).toEqual([]);
  });
});
