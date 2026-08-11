import { THEMES, type ThemeValue } from "@/lib/domain/constants";

export const THEME_STORAGE_KEY = "jpd-theme";

/**
 * Inline script that applies the theme before first paint.
 *
 * Lives in its own server-safe module rather than beside the ThemeProvider: the
 * root layout is a server component, and a `"use client"` module's exports
 * cannot be called from the server.
 *
 * It has to be a blocking inline script. A React effect runs after hydration,
 * by which point the wrong theme has already been painted and the page visibly
 * snaps to the right one on every load.
 *
 * `preferStored` decides who wins. For a signed-in user the account preference
 * is authoritative, because it is the one that follows them between machines —
 * localStorage on any given device may be a stale copy of an older choice. On
 * the sign-in page there is no account yet, so the device's own last choice is
 * the best guess available.
 */
export function themeInitScript(
  resolvedTheme: ThemeValue,
  preferStored: boolean,
): string {
  const valid = JSON.stringify(THEMES);
  const fallback = JSON.stringify(resolvedTheme);
  const key = JSON.stringify(THEME_STORAGE_KEY);

  return `(function(){try{var t=${fallback};${
    preferStored
      ? ""
      : `var s=localStorage.getItem(${key});if(${valid}.indexOf(s)!==-1){t=s;}`
  }localStorage.setItem(${key},t);document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme',${fallback});}})();`;
}
