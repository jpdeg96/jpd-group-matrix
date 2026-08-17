-- Phantom Calculator rates.
--
-- The desktop calculator divides a StubHub get-in price by
-- (1 + tier1) * (1 + stubhub) to get the most it can pay for the ticket. These
-- two columns are the authoritative source for both.

-- AlterTable
ALTER TABLE "public"."settings" ADD COLUMN     "phantom_tier_1_rate" DECIMAL(6,4),
ADD COLUMN     "phantom_stubhub_rate" DECIMAL(6,4);

-- Nullable on purpose, and left null on an existing database.
--
-- Every other settings column has a sensible default. These two must not: a
-- rate that nobody entered is not 0, and it is not 20% either. The calculator
-- refuses to produce a purchase price until an administrator has stated both,
-- which is the whole point — a made-up rate here becomes a real overpayment on
-- a real ticket.

-- A rate is a fraction, not a percentage. Someone typing 20 meaning 20% would
-- otherwise turn a $600 get-in into a $1.30 maximum purchase price and the
-- calculator would report it with a straight face. Below 1 because a 100%+
-- fee is not a thing this business has, and catching the typo is worth more
-- than allowing a case that has never occurred.
ALTER TABLE "settings" ADD CONSTRAINT "settings_phantom_tier_1_rate_check"
  CHECK ("phantom_tier_1_rate" IS NULL OR ("phantom_tier_1_rate" >= 0 AND "phantom_tier_1_rate" < 1));

ALTER TABLE "settings" ADD CONSTRAINT "settings_phantom_stubhub_rate_check"
  CHECK ("phantom_stubhub_rate" IS NULL OR ("phantom_stubhub_rate" >= 0 AND "phantom_stubhub_rate" < 1));
