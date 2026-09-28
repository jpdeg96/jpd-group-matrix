-- Roles and permissions become data.
--
-- Entirely additive. `users.role` is left in place and still populated, so the
-- previously deployed code keeps working against this schema and a rollback
-- loses nothing. Nothing is dropped here; a later migration can retire the
-- enum column once this has been live long enough to trust.
--
-- The grants seeded below reproduce exactly what each role could do when
-- permissions were a rank comparison in code. Anything different would be a
-- silent permission change disguised as a migration.

CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");
CREATE INDEX "roles_sort_order_name_idx" ON "roles"("sort_order", "name");

CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "role_permissions_role_permission_key" ON "role_permissions"("role_id", "permission");
CREATE INDEX "role_permissions_role_id_idx" ON "role_permissions"("role_id");

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict, not cascade: deleting a role that still has people in it must fail
-- loudly rather than quietly deleting the people.
ALTER TABLE "users" ADD COLUMN "role_id" UUID;
ALTER TABLE "users"
  ADD CONSTRAINT "users_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- The three built-ins.
INSERT INTO "roles" ("id", "key", "name", "description", "is_system", "sort_order", "updated_at")
VALUES
  (gen_random_uuid(), 'ADMIN',   'Administrator', 'Full access, including users, roles and settings.', true, 0, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MANAGER', 'Manager',       'Runs the operational work and reviews payroll.',    true, 1, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'USER',    'User',          'Day-to-day event work on their own assignments.',   true, 2, CURRENT_TIMESTAMP);

-- Administrator: everything in the catalogue.
INSERT INTO "role_permissions" ("id", "role_id", "permission")
SELECT gen_random_uuid(), r."id", p."permission"
FROM "roles" r
CROSS JOIN (VALUES
  ('events.editDetails'), ('events.assignOthers'), ('events.workAnyRow'),
  ('events.delete'), ('events.import'), ('events.bulkEdit'), ('flags.clear'),
  ('stages.editDueDates'),
  ('payroll.view'), ('payroll.importTime'), ('payroll.approve'),
  ('payroll.invoice'), ('payroll.remit'), ('payroll.manageContractors'),
  ('metrics.viewTeam'), ('presence.viewTeam'), ('audit.view'),
  ('users.manage'), ('settings.manage'), ('impersonate')
) AS p("permission")
WHERE r."key" = 'ADMIN';

-- Manager: exactly what `canAssignOthers` plus the manager-only routes allowed.
INSERT INTO "role_permissions" ("id", "role_id", "permission")
SELECT gen_random_uuid(), r."id", p."permission"
FROM "roles" r
CROSS JOIN (VALUES
  ('events.editDetails'), ('events.assignOthers'), ('events.workAnyRow'),
  ('events.delete'), ('events.import'), ('events.bulkEdit'), ('flags.clear'),
  ('payroll.view'), ('payroll.importTime'), ('payroll.approve'),
  ('metrics.viewTeam'), ('presence.viewTeam'), ('audit.view')
) AS p("permission")
WHERE r."key" = 'MANAGER';

-- User: no elevated capability. Working their own assignments is not a
-- permission — it is what being the assignee means.

-- Point every existing user at the role they already had.
UPDATE "users" u
SET "role_id" = r."id"
FROM "roles" r
WHERE r."key" = u."role"::TEXT;
