-- Tolerate a deleted approver without losing the invariant that matters.
--
-- The original check demanded that an APPROVED row carry both a timestamp and
-- an approver. That made the row inconsistent the moment a user was deleted:
-- the foreign key sets `approved_by_id` to NULL, and the check then rejected
-- the row, so deleting anyone who had ever approved payroll failed outright.
--
-- Split into the two rules the rest of this schema already uses:
--   * an approval must record *when* it happened, and only an approval may;
--   * attribution without a timestamp is meaningless.
--
-- A null approver on an approved row therefore reads as "the person who
-- approved this no longer has an account", which is true and worth keeping,
-- rather than as corruption.
ALTER TABLE "weekly_approvals" DROP CONSTRAINT "weekly_approvals_approver_coherent_check";

ALTER TABLE "weekly_approvals" ADD CONSTRAINT "weekly_approvals_approved_at_check"
  CHECK (
    ("manager_status" = 'APPROVED' AND "approved_at" IS NOT NULL)
    OR ("manager_status" <> 'APPROVED' AND "approved_at" IS NULL)
  );

ALTER TABLE "weekly_approvals" ADD CONSTRAINT "weekly_approvals_approver_needs_time_check"
  CHECK ("approved_by_id" IS NULL OR "approved_at" IS NOT NULL);
