-- Web push, and the state the clock watcher compares against.
--
-- Entirely additive. Nothing here changes an existing column's meaning, and
-- with the VAPID keys unset the application behaves exactly as it did before:
-- no subscriptions are offered, none are stored, and nothing is sent.

-- One row per browser that has been given permission, not one per person: a
-- phone and a desktop are two, and revoking one must not silence the other.
CREATE TABLE "push_subscriptions" (
  "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
  "user_id"         UUID         NOT NULL,
  "endpoint"        TEXT         NOT NULL,
  "p256dh"          TEXT         NOT NULL,
  "auth"            TEXT         NOT NULL,
  "user_agent"      TEXT,
  "failure_count"   INTEGER      NOT NULL DEFAULT 0,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_success_at" TIMESTAMPTZ(6),
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- The endpoint IS the subscription: a push service issues a new one rather
-- than updating an old one, so this both deduplicates and makes "replace what
-- this device had" a single upsert.
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key"
  ON "push_subscriptions" ("endpoint");

CREATE INDEX "push_subscriptions_user_id_idx"
  ON "push_subscriptions" ("user_id");

ALTER TABLE "push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- What was true at the last poll, so the next one can tell a transition from a
-- steady state. Clocking in happens in Clockify; without something to compare
-- against, every poll would either announce everybody currently on the clock
-- or announce nothing at all.
CREATE TABLE "clock_status" (
  "user_id"    UUID           NOT NULL,
  "running"    BOOLEAN        NOT NULL DEFAULT false,
  "started_at" TIMESTAMPTZ(6),
  "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "clock_status_pkey" PRIMARY KEY ("user_id")
);

ALTER TABLE "clock_status"
  ADD CONSTRAINT "clock_status_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A short, renewable claim on a job only one process may run. The clock poller
-- lives inside the web server; with two instances both would see the same
-- transition and everybody would be told twice.
CREATE TABLE "system_leases" (
  "name"       TEXT           NOT NULL,
  "holder"     TEXT           NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "system_leases_pkey" PRIMARY KEY ("name")
);

-- The person's own say over their phone, separate from whether their role is
-- allowed to be told at all. Defaults to on: somebody who has gone to the
-- trouble of enabling notifications has opted in already, and a second switch
-- defaulted off would read as push being broken.
ALTER TABLE "users"
  ADD COLUMN "push_clock_events" BOOLEAN NOT NULL DEFAULT true;

-- Give the new permission to the two built-in roles that were asked for.
--
-- By key rather than by what each role currently holds: this is a new
-- capability with no previous behaviour to preserve, and "administrators and
-- managers" is the rule it was introduced under. A role somebody has since
-- customised keeps everything else it had; this adds one tick, which the
-- Roles screen can remove.
INSERT INTO "role_permissions" ("id", "role_id", "permission")
SELECT gen_random_uuid(), r."id", 'clock.notify'
FROM "roles" r
WHERE r."key" IN ('ADMIN', 'MANAGER')
ON CONFLICT ("role_id", "permission") DO NOTHING;
