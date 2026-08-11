-- AlterTable
ALTER TABLE "public"."events" ADD COLUMN     "flag_reason" TEXT,
ADD COLUMN     "flag_resolved_at" TIMESTAMPTZ(6),
ADD COLUMN     "flag_resolved_by_id" UUID,
ADD COLUMN     "flagged_at" TIMESTAMPTZ(6),
ADD COLUMN     "flagged_by_id" UUID;

-- AlterTable
ALTER TABLE "public"."settings" ADD COLUMN     "clockify_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "clockify_workspace_id" TEXT;

-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "clockify_user_id" TEXT,
ADD COLUMN     "theme" VARCHAR(16);

-- CreateIndex
CREATE INDEX "events_flagged_idx" ON "public"."events"("flagged_at");

-- AddForeignKey
ALTER TABLE "public"."events" ADD CONSTRAINT "events_flagged_by_id_fkey" FOREIGN KEY ("flagged_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."events" ADD CONSTRAINT "events_flag_resolved_by_id_fkey" FOREIGN KEY ("flag_resolved_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
