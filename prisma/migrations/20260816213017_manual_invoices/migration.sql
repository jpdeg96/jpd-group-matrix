-- CreateEnum
CREATE TYPE "public"."invoice_kind" AS ENUM ('PAYROLL', 'MANUAL');

-- AlterTable
ALTER TABLE "public"."invoices" ADD COLUMN     "description" TEXT,
ADD COLUMN     "kind" "public"."invoice_kind" NOT NULL DEFAULT 'PAYROLL',
ALTER COLUMN "pay_type" DROP NOT NULL;

-- Everything below is what Prisma's schema language cannot express, and is the
-- part that actually keeps a manual invoice from becoming a way around the
-- rules the payroll path is held to.

-- The two kinds are shaped differently, and each shape is required.
--
-- A PAYROLL invoice derives its amount from hours and a pay type, so it must
-- have one and must not carry a free-text description that could contradict
-- the figures. A MANUAL invoice is the reverse: there is no pay type to record
-- and the description is the only statement of what the money is for, so it
-- cannot be blank.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_kind_shape_check"
  CHECK (
    ("kind" = 'PAYROLL' AND "pay_type" IS NOT NULL AND "description" IS NULL)
    OR
    ("kind" = 'MANUAL' AND "pay_type" IS NULL AND btrim(coalesce("description", '')) <> '')
  );

-- A manual invoice records no hours. Leaving the column free would allow a
-- bonus that claims 40 hours nobody worked.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_manual_has_no_hours_check"
  CHECK (
    "kind" <> 'MANUAL'
    OR ("approved_seconds" = 0 AND "hourly_rate" IS NULL AND "weekly_amount" IS NULL)
  );

-- Zero is a valid wage in a week nobody worked; a zero bonus is a mistake.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_manual_amount_positive_check"
  CHECK ("kind" <> 'MANUAL' OR "amount" > 0);

-- One live invoice per contractor per week applied to every invoice, which
-- would have refused a bonus paid in the same week as the wage. Narrowed to
-- the payroll path, which is the only place it was ever protecting anything:
-- the point was that a week of hours cannot be invoiced twice.
DROP INDEX "invoices_one_live_per_contractor_period";

CREATE UNIQUE INDEX "invoices_one_live_per_contractor_period"
  ON "invoices" ("contractor_id", "payroll_period_id")
  WHERE "status" <> 'VOID' AND "kind" = 'PAYROLL';

-- Manual invoices are numbered PREFIX-YYYYMMDD-M1, so they are distinguishable
-- at a glance from a reissue (-R2) and from the wage invoice for the same week.
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_number_format_check";

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_format_check"
  CHECK ("invoice_number" ~ '^[A-Z0-9]{2,10}-[0-9]{8}(-R[0-9]+|-M[0-9]+)?$');

-- The suffix has to agree with the kind, or the number stops being a reliable
-- way to tell them apart.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_matches_kind_check"
  CHECK (
    ("kind" = 'MANUAL') = ("invoice_number" ~ '-M[0-9]+$')
  );
