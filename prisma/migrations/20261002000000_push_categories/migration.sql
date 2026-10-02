-- Per-category notification preferences.
--
-- Replaces the single `push_clock_events` boolean with the set of categories a
-- person has turned off. Additive: the old column stays and is still written in
-- step, so rolling back to the previous release finds the value it expects.

-- The muted set rather than the enabled one. An empty array is a complete and
-- correct preference for everybody who has never touched the switches, so there
-- is nothing to backfill for them — and a category added in a later release is
-- on by default rather than starting silently off for every existing account.
ALTER TABLE "users"
  ADD COLUMN "push_muted" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Carry over the one preference that already existed. Only the people who had
-- actually turned it off: everybody else is covered by the default.
UPDATE "users"
SET "push_muted" = ARRAY['CLOCK']::TEXT[]
WHERE "push_clock_events" = false;
