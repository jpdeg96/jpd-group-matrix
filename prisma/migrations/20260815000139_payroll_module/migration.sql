-- CreateEnum
CREATE TYPE "public"."pay_type" AS ENUM ('FLAT_WEEKLY', 'HOURLY');

-- CreateEnum
CREATE TYPE "public"."approval_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "public"."invoice_status" AS ENUM ('GENERATED', 'SENT', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "public"."contractors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "clockify_user_id" TEXT,
    "pay_type" "public"."pay_type" NOT NULL,
    "weekly_amount" DECIMAL(12,2),
    "hourly_rate" DECIMAL(12,4),
    "invoice_prefix" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "remittance_email" TEXT,
    "discord_webhook_url" TEXT,
    "notes" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payroll_periods" (
    "id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "deposit_date" DATE NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."imported_time_entries" (
    "id" UUID NOT NULL,
    "payroll_period_id" UUID NOT NULL,
    "contractor_id" UUID NOT NULL,
    "clockify_entry_id" TEXT NOT NULL,
    "clockify_user_id" TEXT NOT NULL,
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "end_time" TIMESTAMPTZ(6) NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "description" TEXT,
    "imported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "imported_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."weekly_approvals" (
    "id" UUID NOT NULL,
    "payroll_period_id" UUID NOT NULL,
    "contractor_id" UUID NOT NULL,
    "pay_type" "public"."pay_type" NOT NULL,
    "clockify_seconds" INTEGER NOT NULL DEFAULT 0,
    "weekly_amount" DECIMAL(12,2),
    "hourly_rate" DECIMAL(12,4),
    "invoice_amount" DECIMAL(12,2) NOT NULL,
    "manager_status" "public"."approval_status" NOT NULL DEFAULT 'PENDING',
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "invoice_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "weekly_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invoices" (
    "id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "contractor_id" UUID NOT NULL,
    "payroll_period_id" UUID NOT NULL,
    "pay_type" "public"."pay_type" NOT NULL,
    "approved_seconds" INTEGER NOT NULL DEFAULT 0,
    "weekly_amount" DECIMAL(12,2),
    "hourly_rate" DECIMAL(12,4),
    "amount" DECIMAL(12,2) NOT NULL,
    "pdf_url" TEXT,
    "document_url" TEXT,
    "status" "public"."invoice_status" NOT NULL DEFAULT 'GENERATED',
    "payment_date" DATE,
    "usdt_tx_hash" TEXT,
    "deposit_date" DATE NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(6),
    "void_reason" TEXT,
    "remittance_sent" BOOLEAN NOT NULL DEFAULT false,
    "remittance_sent_at" TIMESTAMPTZ(6),
    "remittance_error" TEXT,
    "last_remittance_check" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contractors_clockify_user_id_key" ON "public"."contractors"("clockify_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "contractors_invoice_prefix_key" ON "public"."contractors"("invoice_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "contractors_user_id_key" ON "public"."contractors"("user_id");

-- CreateIndex
CREATE INDEX "contractors_active_name_idx" ON "public"."contractors"("active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_periods_period_start_key" ON "public"."payroll_periods"("period_start");

-- CreateIndex
CREATE INDEX "payroll_periods_period_start_idx" ON "public"."payroll_periods"("period_start" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "imported_time_entries_clockify_entry_id_key" ON "public"."imported_time_entries"("clockify_entry_id");

-- CreateIndex
CREATE INDEX "imported_time_entries_payroll_period_id_contractor_id_idx" ON "public"."imported_time_entries"("payroll_period_id", "contractor_id");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_approvals_invoice_id_key" ON "public"."weekly_approvals"("invoice_id");

-- CreateIndex
CREATE INDEX "weekly_approvals_payroll_period_id_manager_status_idx" ON "public"."weekly_approvals"("payroll_period_id", "manager_status");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_approvals_payroll_period_id_contractor_id_key" ON "public"."weekly_approvals"("payroll_period_id", "contractor_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "public"."invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_payroll_period_id_status_idx" ON "public"."invoices"("payroll_period_id", "status");

-- CreateIndex
CREATE INDEX "invoices_contractor_id_generated_at_idx" ON "public"."invoices"("contractor_id", "generated_at" DESC);

-- AddForeignKey
ALTER TABLE "public"."contractors" ADD CONSTRAINT "contractors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."imported_time_entries" ADD CONSTRAINT "imported_time_entries_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."imported_time_entries" ADD CONSTRAINT "imported_time_entries_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."weekly_approvals" ADD CONSTRAINT "weekly_approvals_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."weekly_approvals" ADD CONSTRAINT "weekly_approvals_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."weekly_approvals" ADD CONSTRAINT "weekly_approvals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."weekly_approvals" ADD CONSTRAINT "weekly_approvals_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invoices" ADD CONSTRAINT "invoices_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "public"."contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invoices" ADD CONSTRAINT "invoices_payroll_period_id_fkey" FOREIGN KEY ("payroll_period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariants Prisma cannot express.
--
-- These are the rules that protect money. The spreadsheet this replaces had no
-- way to state them, which is how it ended up with a pay period in 1969 and an
-- amount that was really a timestamp.
-- ---------------------------------------------------------------------------

-- A contractor must carry the rate their pay type is actually paid from.
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_pay_rate_present_check"
  CHECK (
    ("pay_type" = 'FLAT_WEEKLY' AND "weekly_amount" IS NOT NULL)
    OR ("pay_type" = 'HOURLY' AND "hourly_rate" IS NOT NULL)
  );

ALTER TABLE "contractors" ADD CONSTRAINT "contractors_rates_non_negative_check"
  CHECK (
    ("weekly_amount" IS NULL OR "weekly_amount" >= 0)
    AND ("hourly_rate" IS NULL OR "hourly_rate" >= 0)
  );

-- An invoice prefix becomes part of an invoice number, so it must be stable
-- and predictable: upper-case letters and digits only.
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_invoice_prefix_format_check"
  CHECK ("invoice_prefix" ~ '^[A-Z0-9]{2,10}$');

ALTER TABLE "contractors" ADD CONSTRAINT "contractors_name_not_blank_check"
  CHECK (btrim("name") <> '');

-- A pay week is exactly Sunday to Saturday, and the deposit lands the Friday
-- after it. Stated here so no code path can write a period of another shape.
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_shape_check"
  CHECK (
    EXTRACT(DOW FROM "period_start") = 0
    AND EXTRACT(DOW FROM "period_end") = 6
    AND "period_end" = "period_start" + INTERVAL '6 days'
    AND "deposit_date" = "period_end" + INTERVAL '6 days'
  );

-- The 1969 guard. A date outside this range is a bug, not data.
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_sane_range_check"
  CHECK ("period_start" >= DATE '2024-01-01' AND "period_start" < DATE '2100-01-01');

-- Time cannot run backwards, and a single entry cannot exceed a week.
ALTER TABLE "imported_time_entries" ADD CONSTRAINT "imported_time_entries_interval_check"
  CHECK ("end_time" > "start_time");

ALTER TABLE "imported_time_entries" ADD CONSTRAINT "imported_time_entries_duration_check"
  CHECK ("duration_seconds" > 0 AND "duration_seconds" <= 604800);

ALTER TABLE "weekly_approvals" ADD CONSTRAINT "weekly_approvals_amount_non_negative_check"
  CHECK ("invoice_amount" >= 0);

ALTER TABLE "weekly_approvals" ADD CONSTRAINT "weekly_approvals_seconds_non_negative_check"
  CHECK ("clockify_seconds" >= 0);

-- Approval and approver travel together, exactly as the event completion
-- columns do elsewhere in this schema.
ALTER TABLE "weekly_approvals" ADD CONSTRAINT "weekly_approvals_approver_coherent_check"
  CHECK (
    ("manager_status" = 'APPROVED' AND "approved_at" IS NOT NULL AND "approved_by_id" IS NOT NULL)
    OR ("manager_status" <> 'APPROVED')
  );

-- Only an approved row may carry an invoice.
ALTER TABLE "weekly_approvals" ADD CONSTRAINT "weekly_approvals_invoice_requires_approval_check"
  CHECK ("invoice_id" IS NULL OR "manager_status" = 'APPROVED');

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_non_negative_check"
  CHECK ("amount" >= 0);

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_format_check"
  CHECK ("invoice_number" ~ '^[A-Z0-9]{2,10}-[0-9]{8}$');

-- Paid means there is a payment date. Without this, "Paid" can be asserted
-- with nothing behind it, which is precisely the audit hole being closed.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_has_date_check"
  CHECK ("status" <> 'PAID' OR "payment_date" IS NOT NULL);

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_void_has_reason_check"
  CHECK ("status" <> 'VOID' OR ("voided_at" IS NOT NULL AND btrim(coalesce("void_reason", '')) <> ''));

-- One live invoice per contractor per week. Voided ones are excluded so a
-- corrected invoice can be reissued without deleting the original.
CREATE UNIQUE INDEX "invoices_one_live_per_contractor_period"
  ON "invoices" ("contractor_id", "payroll_period_id")
  WHERE "status" <> 'VOID';
