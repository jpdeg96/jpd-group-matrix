-- AlterTable
ALTER TABLE "public"."invoices" ADD COLUMN     "drive_error" TEXT,
ADD COLUMN     "drive_file_id" TEXT,
ADD COLUMN     "drive_uploaded_at" TIMESTAMPTZ(6),
ADD COLUMN     "drive_web_link" TEXT;

-- AlterTable
ALTER TABLE "public"."settings" ADD COLUMN     "clockify_health_checked_at" TIMESTAMPTZ(6),
ADD COLUMN     "clockify_healthy" BOOLEAN,
ADD COLUMN     "discord_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "discord_last_release_id" TEXT,
ADD COLUMN     "drive_folder_id" TEXT,
ADD COLUMN     "drive_upload_enabled" BOOLEAN NOT NULL DEFAULT false;
