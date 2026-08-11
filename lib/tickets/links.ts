/**
 * Marketplace deep links.
 *
 * These build *search* URLs from the event's own fields. No API key, no
 * approval process, no network call — the link is derived, so it cannot break
 * because a credential expired or a rate limit was hit, and it works from the
 * moment an event is typed in.
 *
 * The trade-off is honest: a search link lands the user on a results page
 * rather than the exact event. For a well-identified event (team names plus a
 * venue) that page is almost always a single obvious result. Exact-event links
 * would require the marketplaces' APIs — see `resolveExactLink` below for where
 * that would slot in.
 */

import { formatPlainDate, type PlainDate } from "@/lib/date/plain-date";

export interface TicketLinkInput {
  awayTeam: string | null;
  homeTeam: string | null;
  venue: string | null;
  eventDate: PlainDate;
}

export interface MarketplaceLink {
  marketplace: "SEATGEEK" | "STUBHUB";
  label: string;
  url: string;
  /** Human-readable text of what was actually searched for. */
  query: string;
  /** Brand colour, so the two are distinguishable at a glance in a dense row. */
  color: string;
}

/** Brand colours for the marketplace buttons. */
export const MARKETPLACE_COLORS = {
  SEATGEEK: "#e2231a",
  STUBHUB: "#6c3aa0",
} as const;

/**
 * Builds the search phrase.
 *
 * Home team first: that is how both marketplaces title their listings
 * ("Chicago Cubs vs Los Angeles Dodgers"), so leading with it matches more
 * reliably than the away-first order the table displays.
 *
 * For single-performer events only the artist is present, which is exactly the
 * right query on its own.
 */
export function buildSearchQuery(event: TicketLinkInput): string {
  const parts = [event.homeTeam, event.awayTeam]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  // Fall back to the venue when neither team nor artist is recorded — better
  // than an empty search.
  if (parts.length === 0 && event.venue) {
    return event.venue.trim();
  }

  return parts.join(" ");
}

/**
 * StubHub search phrase: the home team alone, falling back to the away team or
 * artist when there is no home team.
 *
 * Narrower than the SeatGeek query on purpose. StubHub's search matches a
 * single well-known name far more reliably than a full "Home vs Away" string,
 * which often returns nothing.
 */
export function buildStubHubQuery(event: TicketLinkInput): string {
  const home = event.homeTeam?.trim();
  if (home) return home;

  const away = event.awayTeam?.trim();
  if (away) return away;

  return event.venue?.trim() ?? "";
}

export function seatGeekLink(event: TicketLinkInput): MarketplaceLink | null {
  const query = buildSearchQuery(event);
  if (!query) return null;

  const url = new URL("https://seatgeek.com/search");
  url.searchParams.set("search", query);

  return {
    marketplace: "SEATGEEK",
    label: "SeatGeek",
    url: url.toString(),
    query,
    color: MARKETPLACE_COLORS.SEATGEEK,
  };
}

export function stubHubLink(event: TicketLinkInput): MarketplaceLink | null {
  const query = buildStubHubQuery(event);
  if (!query) return null;

  // `/search?q=` — verified against the live site. The older `/find/s/?q=`
  // form returns StubHub's "Page Not Found".
  const url = new URL("https://www.stubhub.com/search");
  url.searchParams.set("q", query);

  return {
    marketplace: "STUBHUB",
    label: "StubHub",
    url: url.toString(),
    query,
    color: MARKETPLACE_COLORS.STUBHUB,
  };
}

/** Both links, with any that could not be built omitted. */
export function marketplaceLinks(
  event: TicketLinkInput,
  options: { seatGeek: boolean; stubHub: boolean },
): MarketplaceLink[] {
  const links: MarketplaceLink[] = [];

  if (options.seatGeek) {
    const link = seatGeekLink(event);
    if (link) links.push(link);
  }

  if (options.stubHub) {
    const link = stubHubLink(event);
    if (link) links.push(link);
  }

  return links;
}

/** Tooltip text, so it is obvious what a link will actually do before clicking. */
export function describeLink(link: MarketplaceLink, eventDate: PlainDate): string {
  return `Search ${link.label} for "${link.query}" around ${formatPlainDate(eventDate)}`;
}

/*
 * ---------------------------------------------------------------------------
 * Exact-event links (not implemented)
 * ---------------------------------------------------------------------------
 *
 * Upgrading from search links to exact event URLs means querying each
 * marketplace and matching on name + date + venue. That is a per-event network
 * call with credentials, caching and a fallback path, so it is deliberately
 * left out of the first version rather than half-built.
 *
 * If it is added later, the shape is:
 *
 *   async function resolveExactLink(
 *     event: TicketLinkInput,
 *     marketplace: "SEATGEEK" | "STUBHUB",
 *   ): Promise<MarketplaceLink | null>
 *
 * with the resolved URL cached on the event row so the lookup happens once.
 * The search link stays as the fallback whenever a lookup fails or is
 * ambiguous — the feature should degrade, never disappear.
 *
 * Access differs sharply between the two: SeatGeek has historically offered a
 * self-serve developer API, whereas StubHub's moved to partner/commercial
 * access. Confirm current terms for both before relying on either.
 */
