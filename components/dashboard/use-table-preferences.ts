"use client";

import * as React from "react";

/** "All" is a real choice, not a sentinel for "very large". */
export type PageSize = 50 | 100 | 250 | "ALL";

export const PAGE_SIZES: readonly PageSize[] = [50, 100, 250, "ALL"];

export interface TablePreferences {
  pageSize: PageSize;
  stripeRows: boolean;
}

const DEFAULTS: TablePreferences = {
  // Not "ALL". Six hundred rows renders fine but scrolls badly, and a first
  // visit should land on something navigable rather than on everything.
  pageSize: 50,
  stripeRows: false,
};

function storageKey(table: string): string {
  return `jpd:table-prefs:${table}`;
}

function isPageSize(value: unknown): value is PageSize {
  return value === "ALL" || value === 50 || value === 100 || value === 250;
}

/**
 * Page size and row shading, remembered between sessions.
 *
 * localStorage rather than the database, deliberately. These are properties of
 * the screen somebody is looking at — a laptop and a large monitor genuinely
 * want different page sizes — and syncing them would make choosing one on the
 * laptop change the other. Nothing here is data; losing it costs one click.
 *
 * Read in an effect rather than during the first render, because the server has
 * no localStorage: initialising from it directly renders one thing on the
 * server and another on the client, which is a hydration mismatch. The first
 * paint is the default and it is corrected immediately.
 */
export function useTablePreferences(table: string) {
  const [preferences, setPreferences] = React.useState<TablePreferences>(DEFAULTS);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(table));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TablePreferences>;
        setPreferences({
          pageSize: isPageSize(parsed.pageSize) ? parsed.pageSize : DEFAULTS.pageSize,
          stripeRows:
            typeof parsed.stripeRows === "boolean"
              ? parsed.stripeRows
              : DEFAULTS.stripeRows,
        });
      }
    } catch {
      // A private window, cleared site data, or a value from an older shape.
      // The defaults are always a working screen.
    }
    setLoaded(true);
  }, [table]);

  const update = React.useCallback(
    (patch: Partial<TablePreferences>) => {
      setPreferences((current) => {
        const next = { ...current, ...patch };
        try {
          window.localStorage.setItem(storageKey(table), JSON.stringify(next));
        } catch {
          // Storage can throw outright where site data is blocked. The choice
          // still applies for this session; it just will not be remembered.
        }
        return next;
      });
    },
    [table],
  );

  return { ...preferences, loaded, update };
}

/** Human label for a page size. */
export function pageSizeLabel(size: PageSize): string {
  return size === "ALL" ? "All" : String(size);
}
