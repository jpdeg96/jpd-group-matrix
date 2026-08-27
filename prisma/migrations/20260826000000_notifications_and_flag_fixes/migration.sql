-- Notifications, flag hand-back, and the per-person Start override.
--
-- Entirely additive: a new table, a new enum, and columns that default. Nothing
-- is dropped and nothing is made stricter, so the currently-deployed code keeps
-- working against this schema and it is safe to run before the deploy.

CREATE TYPE "notification_kind" AS ENUM ('FLAG_RAISED', 'FLAG_FIXED', 'FLAG_CLEARED', 'MENTIONED');

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "actor_id" UUID,
    "kind" "notification_kind" NOT NULL,
    "event_id" UUID NOT NULL,
    "detail" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_recipient_idx" ON "notifications"("recipient_id", "read_at", "created_at" DESC);
CREATE INDEX "notifications_event_idx" ON "notifications"("event_id");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_recipient_id_fkey"
  FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cascade rather than restrict: a notification pointing at a deleted event is a
-- dead link, not history worth keeping. The audit log is where deletions live.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- "I have dealt with this", distinct from "a manager has signed it off".
ALTER TABLE "events" ADD COLUMN "flag_fixed_at" TIMESTAMPTZ(6);
ALTER TABLE "events" ADD COLUMN "flag_fixed_by_id" UUID;

ALTER TABLE "events"
  ADD CONSTRAINT "events_flag_fixed_by_id_fkey"
  FOREIGN KEY ("flag_fixed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Off for everyone by default; granted per person where the exception is real.
ALTER TABLE "users" ADD COLUMN "can_start_completed" BOOLEAN NOT NULL DEFAULT false;
