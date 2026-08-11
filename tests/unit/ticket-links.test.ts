import { describe, expect, it } from "vitest";
import { toPlainDate } from "@/lib/date/plain-date";
import {
  buildSearchQuery,
  buildStubHubQuery,
  MARKETPLACE_COLORS,
  marketplaceLinks,
  seatGeekLink,
  stubHubLink,
} from "@/lib/tickets/links";

const matchup = {
  awayTeam: "Los Angeles Dodgers",
  homeTeam: "Chicago Cubs",
  venue: "Wrigley Field",
  eventDate: toPlainDate("2026-09-12"),
};

describe("buildSearchQuery", () => {
  it("leads with the home team, matching how listings are titled", () => {
    expect(buildSearchQuery(matchup)).toBe("Chicago Cubs Los Angeles Dodgers");
  });

  it("uses the artist alone for a single-performer event", () => {
    expect(
      buildSearchQuery({ ...matchup, homeTeam: null, awayTeam: "Bad Bunny" }),
    ).toBe("Bad Bunny");
  });

  it("falls back to the venue when no teams are recorded", () => {
    expect(
      buildSearchQuery({ ...matchup, awayTeam: null, homeTeam: null }),
    ).toBe("Wrigley Field");
  });

  it("ignores whitespace-only values", () => {
    expect(
      buildSearchQuery({ ...matchup, awayTeam: "   ", homeTeam: "Chicago Cubs" }),
    ).toBe("Chicago Cubs");
  });
});

describe("buildStubHubQuery", () => {
  it("uses the home team alone", () => {
    // Narrower than the SeatGeek query on purpose: StubHub matches a single
    // well-known name far more reliably than "Home vs Away".
    expect(buildStubHubQuery(matchup)).toBe("Chicago Cubs");
  });

  it("falls back to the away team or artist when there is no home team", () => {
    expect(
      buildStubHubQuery({ ...matchup, homeTeam: null, awayTeam: "Bad Bunny" }),
    ).toBe("Bad Bunny");
  });

  it("falls back to the venue when neither is recorded", () => {
    expect(
      buildStubHubQuery({ ...matchup, homeTeam: null, awayTeam: null }),
    ).toBe("Wrigley Field");
  });

  it("ignores a whitespace-only home team", () => {
    expect(buildStubHubQuery({ ...matchup, homeTeam: "   " })).toBe(
      "Los Angeles Dodgers",
    );
  });
});

describe("marketplace URLs", () => {
  it("builds the StubHub search URL from the home team only", () => {
    // Regression guard: `/find/s/?q=` returns StubHub's "Page Not Found".
    const link = stubHubLink(matchup);
    expect(link?.url).toBe("https://www.stubhub.com/search?q=Chicago+Cubs");
    expect(link?.url).not.toContain("/find/s/");
    expect(link?.url).not.toContain("Dodgers");
  });

  it("gives each marketplace its brand color", () => {
    expect(stubHubLink(matchup)?.color).toBe(MARKETPLACE_COLORS.STUBHUB);
    expect(seatGeekLink(matchup)?.color).toBe(MARKETPLACE_COLORS.SEATGEEK);
  });

  it("builds the SeatGeek search URL", () => {
    expect(seatGeekLink(matchup)?.url).toBe(
      "https://seatgeek.com/search?search=Chicago+Cubs+Los+Angeles+Dodgers",
    );
  });

  it("escapes characters that would otherwise break the query string", () => {
    const link = seatGeekLink({ ...matchup, homeTeam: "Rock & Roll", awayTeam: null });
    expect(link?.url).toContain("Rock+%26+Roll");
  });

  it("returns nothing when there is nothing to search for", () => {
    const empty = { awayTeam: null, homeTeam: null, venue: null, eventDate: matchup.eventDate };
    expect(seatGeekLink(empty)).toBeNull();
    expect(stubHubLink(empty)).toBeNull();
  });

  it("honours the per-marketplace toggles", () => {
    expect(marketplaceLinks(matchup, { seatGeek: true, stubHub: true })).toHaveLength(2);
    expect(
      marketplaceLinks(matchup, { seatGeek: true, stubHub: false }).map((l) => l.marketplace),
    ).toEqual(["SEATGEEK"]);
    expect(marketplaceLinks(matchup, { seatGeek: false, stubHub: false })).toHaveLength(0);
  });
});
