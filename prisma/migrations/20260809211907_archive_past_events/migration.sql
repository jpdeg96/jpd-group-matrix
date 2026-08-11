-- AlterTable
ALTER TABLE "public"."events" ADD COLUMN     "archived_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "events_archived_idx" ON "public"."events"("archived_at", "event_date");
