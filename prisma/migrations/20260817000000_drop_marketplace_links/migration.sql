-- Remove the SeatGeek and StubHub marketplace links.
--
-- These built search URLs from an event's own teams and venue and rendered them
-- as a Tickets column on the Dashboard and in C1. They are gone from the
-- product, so the two switches that controlled them are dead configuration.
--
-- Dropping rather than leaving them: a settings column nothing reads is a
-- question someone has to answer later ("what is this for?"), and the honest
-- answer would be "nothing".
--
-- NOTE: this is unrelated to the SeatGeek *checkbox* on an event, which is a
-- workflow step and stays exactly as it is. `events.seatgeek_checked_at` and
-- `events.ticketdata_checked` are untouched.

ALTER TABLE "settings" DROP COLUMN IF EXISTS "seatgeek_links_enabled";
ALTER TABLE "settings" DROP COLUMN IF EXISTS "stubhub_links_enabled";
