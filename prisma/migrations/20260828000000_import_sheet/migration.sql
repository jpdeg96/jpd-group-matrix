-- The Google Sheet that Bulk import can read from.
--
-- Additive and nullable: existing rows keep working untouched, and the feature
-- is inert until somebody fills the ID in. Safe to run before the deploy.

ALTER TABLE "settings" ADD COLUMN "import_sheet_id" TEXT;
ALTER TABLE "settings" ADD COLUMN "import_sheet_tab" TEXT;
