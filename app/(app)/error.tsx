"use client";

import * as React from "react";
import { Button } from "@/components/ui/primitives";

/**
 * Error boundary for the authenticated area.
 *
 * Shows that something failed and offers a retry, rather than a blank screen.
 * The underlying error is logged on the server; only a digest is surfaced here,
 * so internal details are not exposed in the UI.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[app] render error", error);
  }, [error]);

  return (
    <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-6 py-16 text-center">
      <p className="text-[14px] font-semibold">Something went wrong</p>
      <p className="mx-auto mt-1.5 max-w-md text-[12.5px] text-[var(--color-ink-muted)]">
        This screen could not be loaded. Your data has not been changed — retry,
        and if it keeps happening pass the reference below to whoever maintains
        this application.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-[11px] text-[var(--color-ink-subtle)]">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-4">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
