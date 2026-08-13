"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads the page when somebody else changes shared data.
 *
 * `router.refresh()` rather than a bespoke fetch-and-merge: both tables already
 * mirror their `initial*` props into state with an effect, so a refresh flows
 * through the exact path that rendered the page in the first place. Client
 * state — scroll, filters, column widths, an open dialog — is preserved,
 * because only the server components re-run.
 *
 * Two things this deliberately does *not* do.
 *
 * It does not refresh while this user has a write in flight. Their own optimistic
 * value is newer than anything the server can currently return, and replacing it
 * mid-edit makes a checkbox visibly flip back before settling. The refresh is
 * held and fired once they are idle.
 *
 * It does not act on the first revision it sees. That one is just the baseline
 * observed on connect; treating it as a change would make every client refetch
 * data it had server-rendered a moment earlier.
 */
export function useLiveRefresh(revision: string | null, busy: boolean): void {
  const router = useRouter();
  const lastSeen = React.useRef<string | null>(null);
  const deferred = React.useRef(false);

  React.useEffect(() => {
    if (revision === null) return;

    if (lastSeen.current === null) {
      lastSeen.current = revision;
      return;
    }

    if (revision === lastSeen.current) return;
    lastSeen.current = revision;

    if (busy) {
      deferred.current = true;
      return;
    }

    router.refresh();
  }, [revision, busy, router]);

  // Whatever arrived while they were mid-write lands as soon as they stop.
  React.useEffect(() => {
    if (busy || !deferred.current) return;
    deferred.current = false;
    router.refresh();
  }, [busy, router]);
}
