import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolves which logo file actually exists.
 *
 * Checked on the server rather than probed in the browser with an `onError`
 * fallback: that approach works, but every page load fires a 404 for the
 * missing file, which buries real errors in the console.
 *
 * Preference order is PNG then SVG, so dropping `public/jpd-logo.png` in is the
 * whole installation step. Extensions are tried in order so a JPG works too.
 */
const CANDIDATES = [
  "/jpd-logo.png",
  "/jpd-logo.jpg",
  "/jpd-logo.jpeg",
  "/jpd-logo.webp",
  "/jpd-logo.svg",
] as const;

export function resolveLogoSrc(): string {
  const publicDir = path.join(process.cwd(), "public");

  for (const candidate of CANDIDATES) {
    if (existsSync(path.join(publicDir, candidate.slice(1)))) return candidate;
  }

  // Nothing present: fall back to the SVG path anyway so the markup is stable
  // and adding the file later needs no code change.
  return "/jpd-logo.svg";
}
