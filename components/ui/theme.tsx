"use client";

import * as React from "react";
import { isTheme, THEME_LABELS, THEMES, type ThemeValue } from "@/lib/domain/constants";
import { THEME_STORAGE_KEY } from "@/lib/ui/theme-script";
import { cn } from "@/lib/ui/cn";

interface ThemeContextValue {
  theme: ThemeValue;
  setTheme: (theme: ThemeValue) => void;
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within <ThemeProvider>.");
  return context;
}

export function ThemeProvider({
  defaultTheme,
  persist = false,
  children,
}: {
  defaultTheme: ThemeValue;
  /**
   * Save the choice to the signed-in user's account as well as localStorage.
   * Off on the sign-in page, where there is nobody to save it against.
   */
  persist?: boolean;
  children: React.ReactNode;
}) {
  /**
   * Starts at the server's default so the first client render matches the
   * server's HTML exactly, then syncs to whatever the pre-paint script actually
   * applied.
   *
   * Reading localStorage in the initialiser would be tempting but produces a
   * hydration mismatch: the server has no way to know the stored value, so the
   * two renders disagree and React discards the tree.
   *
   * The visible theme is already correct throughout — the inline script set the
   * `data-theme` attribute before first paint. This state only drives which
   * button looks selected.
   */
  const [theme, setThemeState] = React.useState<ThemeValue>(defaultTheme);

  React.useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (isTheme(current) && current !== theme) setThemeState(current);
    // Runs once on mount: it reconciles with the pre-paint script, and every
    // later change goes through setTheme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = React.useCallback(
    (next: ThemeValue) => {
      setThemeState(next);
      document.documentElement.setAttribute("data-theme", next);

      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Private browsing with storage disabled — the theme still applies for
        // this session, it just will not be remembered on this machine.
      }

      if (persist) {
        // Fire-and-forget. localStorage already made the choice stick here; the
        // server copy only matters on the *next* machine, so a failed write is
        // not worth interrupting anyone over.
        void fetch("/api/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ theme: next }),
        }).catch(() => undefined);
      }
    },
    [persist],
  );

  const value = React.useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const THEME_SWATCH: Record<ThemeValue, string> = {
  light: "#ffffff",
  dark: "#2b3040",
  blossom: "#f9c8dd",
};

/** Segmented control for switching theme. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md border p-0.5",
        className,
      )}
      style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
    >
      {THEMES.map((value) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            title={THEME_LABELS[value]}
            onClick={() => setTheme(value)}
            className={cn(
              "flex h-6 items-center gap-1.5 rounded px-1.5 text-[11.5px] font-medium transition",
              active ? "opacity-100" : "opacity-60 hover:opacity-100",
            )}
            style={{
              background: active ? "var(--accent-soft)" : "transparent",
              color: active ? "var(--accent)" : "var(--ink-muted)",
            }}
          >
            <span
              aria-hidden
              className="h-3 w-3 rounded-full border"
              style={{
                background: THEME_SWATCH[value],
                borderColor: "var(--line-strong)",
              }}
            />
            <span className="hidden lg:inline">{THEME_LABELS[value]}</span>
          </button>
        );
      })}
    </div>
  );
}
