-- AlterTable
ALTER TABLE "public"."settings" ADD COLUMN     "admin_remittance_email" TEXT,
ADD COLUMN     "business_address" TEXT,
ADD COLUMN     "business_name" TEXT NOT NULL DEFAULT 'JPD Group',
ADD COLUMN     "invoice_note" TEXT,
ADD COLUMN     "remittance_footer_note" TEXT,
ADD COLUMN     "remittance_from_name" TEXT NOT NULL DEFAULT 'JPD Group Payroll',
ADD COLUMN     "remittance_payment_method" TEXT NOT NULL DEFAULT 'USDT';
