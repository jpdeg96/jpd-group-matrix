-- AlterTable
ALTER TABLE "public"."event_types" ADD COLUMN     "emoji" VARCHAR(8);

-- AlterTable
ALTER TABLE "public"."events" ADD COLUMN     "audited_at" TIMESTAMPTZ(6),
ADD COLUMN     "audited_by_id" UUID;

-- AddForeignKey
ALTER TABLE "public"."events" ADD CONSTRAINT "events_audited_by_id_fkey" FOREIGN KEY ("audited_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
