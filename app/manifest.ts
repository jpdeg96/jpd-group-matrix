import type { MetadataRoute } from "next";

/**
 * Web app manifest.
 *
 * Generated here rather than kept as a static `site.webmanifest` so the name
 * cannot drift from the one in `metadata`, and so the icon paths are checked at
 * build time instead of 404ing silently on someone's phone.
 *
 * `theme_color` is the light-theme canvas rather than an accent: it paints the
 * browser chrome around the app, and matching the page background is what stops
 * a visible seam above the header.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JPD Group Matrix",
    short_name: "Matrix",
    description: "Internal event workflow system.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#fafafa",
    icons: [
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
