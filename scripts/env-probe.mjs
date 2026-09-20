/**
 * Temporary build-time probe: what does the build actually see?
 *
 * Added because `prisma migrate deploy` failed twice on Render with
 * `P1012 Environment variable not found: DIRECT_URL`, on a service where that
 * variable is reported as set. Rather than guess at the dashboard again, this
 * asks the build itself.
 *
 * ## It never prints a value
 *
 * Every line below is a name, a length, or a boolean. The connection strings
 * contain a password and a host, and a build log is not a place to put either
 * — they are readable by anyone with access to the deploy history, and they
 * outlive the deploy. Lengths and flags are enough to tell an unset variable
 * from a mistyped one, which is the entire question.
 *
 * ## It never fails the build
 *
 * Exits 0 whatever it finds. A diagnostic that can break a deploy is worse
 * than the problem it was added to investigate.
 *
 * DELETE THIS FILE once the answer is known. It has no business running on
 * every future build.
 */

const INTERESTING = /^(DATABASE_URL|DIRECT_URL)$/;
const RELATED = /(DATABASE|DIRECT|POSTGRES|PRISMA|PG)/i;

function describe(name) {
  const raw = process.env[name];
  if (raw === undefined) return `${name}: NOT SET`;
  if (raw === "") return `${name}: set but EMPTY`;

  // Shape only. No host, no user, no password, no database name.
  const scheme = /^([a-z+]+):\/\//i.exec(raw)?.[1] ?? "(no scheme)";
  const port = /:(\d{2,5})\//.exec(raw)?.[1] ?? "(none)";
  const pooled =
    /pgbouncer=true/i.test(raw) || /-pooler/i.test(raw) || port === "6543";

  return [
    `${name}: SET`,
    `  length ${raw.length}`,
    `  scheme ${scheme}`,
    `  port   ${port}`,
    `  looks pooled: ${pooled}`,
    `  leading/trailing whitespace in value: ${raw !== raw.trim()}`,
  ].join("\n");
}

console.log("--- env probe (names and shapes only; no values) ---");
console.log(describe("DATABASE_URL"));
console.log(describe("DIRECT_URL"));

// A key that is *almost* DIRECT_URL is the likeliest explanation for a variable
// that is set in the dashboard and missing in the process: a trailing space or
// a stray case difference makes a different key entirely.
const keys = Object.keys(process.env);
const nearMisses = keys.filter(
  (k) => !INTERESTING.test(k) && INTERESTING.test(k.trim().toUpperCase()),
);

console.log(
  nearMisses.length
    ? `near-miss keys (whitespace or case): ${nearMisses.map((k) => JSON.stringify(k)).join(", ")}`
    : "near-miss keys: none",
);

console.log(
  `related keys visible: ${keys.filter((k) => RELATED.test(k)).sort().join(", ") || "(none)"}`,
);
console.log(`total env vars visible: ${keys.length}`);
console.log("--- end env probe ---");
