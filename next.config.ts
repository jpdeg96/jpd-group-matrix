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
};

export default nextConfig;
