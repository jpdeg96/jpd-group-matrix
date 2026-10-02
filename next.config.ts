import type { NextConfig } from "next";

/**
 * Note on timezones: nothing here pins one, deliberately.
 *
 * The application never reads the host's local timezone. Business dates resolve
 * through `businessToday()` against America/Chicago by name, and stored
 * instants are UTC. That holds on any host, so there is no server TZ to
 * configure and no UTC offset written down anywhere.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Packages that must be required at runtime rather than bundled.
   *
   * `pdfkit` reads its font metrics from disk — `data/Helvetica.afm`, resolved
   * relative to its own module. Bundling moves the code into
   * `.next/server/chunks` without those files, so every invoice PDF fails with
   * ENOENT. Left external, it loads from node_modules with its data intact.
   *
   * `web-push` pulls in `https-proxy-agent`, which requires Node's `http` and
   * `https` by name. It is reached from `instrumentation.ts`, which Next
   * compiles for every runtime including ones that have no such modules — and
   * a resolution failure there is not contained to the feature: it takes down
   * every route in the application with a 500. External, it is never traced
   * into that graph.
   */
  serverExternalPackages: ["pdfkit", "web-push"],
};

export default nextConfig;
