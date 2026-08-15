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
   * pdfkit must not be bundled.
   *
   * It reads its font metrics from disk at runtime — `data/Helvetica.afm`,
   * resolved relative to its own module. Bundling moves the code into
   * `.next/server/chunks` without those files, so every invoice PDF fails with
   * ENOENT. Left external, it loads from node_modules with its data intact.
   */
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
