-- Invoice numbers may carry a reissue suffix.
--
-- A voided invoice keeps its number: it is still a document that existed, and
-- two documents sharing an identifier defeats the point of having one. A
-- corrected invoice for the same week is therefore NAT-20260705-R2.
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_number_format_check";

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_number_format_check"
  CHECK ("invoice_number" ~ '^[A-Z0-9]{2,10}-[0-9]{8}(-R[0-9]+)?$');
