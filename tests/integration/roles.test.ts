/**
 * Editable roles.
 *
 * The cases that matter most here are the refusals. Everything else is a
 * checkbox writing a row; the lock-out guards are the reason this feature is
 * not simply a table with a UI on top, because the failure they prevent —
 * nobody able to reach Users or Settings — cannot be undone from inside the
 * application.
 *
 * DESTRUCTIVE: truncates users and roles. Runs against TEST_DATABASE_URL.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createRole,
  deleteRole,
  listRoles,
  setRolePermissions,
  updateRole,
} from "@/lib/services/roles";
import { updateUser } from "@/lib/services/users";
import { DEFAULT_GRANTS, type Permission } from "@/lib/domain/permissions";
import type { ActorContext } from "@/lib/auth/actor";

const hasDatabase = Boolean(process.env.DATABASE_URL);
const suite = hasDatabase ? describe : describe.skip;

suite("roles and permissions", () => {
  let admin: ActorContext;
  let adminRoleId: string;
  let userRoleId: string;

  const actorFor = (
    user: { id: string; email: string; displayName: string },
    permissions: readonly Permission[],
  ): ActorContext => {
    const resolved = {
      ...user,
      role: "ADMIN",
      roleName: "Administrator",
      permissions: new Set(permissions),
      color: "#2563eb",
      theme: null,
    };
    return { effective: resolved, real: resolved, isImpersonating: false };
  };

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();
    await prisma.rolePermission.deleteMany({ where: { role: { isSystem: false } } });
    await prisma.role.deleteMany({ where: { isSystem: false } });

    // The seeded built-ins survive truncation; restore their grants in case an
    // earlier test changed them.
    for (const [key, grants] of Object.entries(DEFAULT_GRANTS)) {
      const role = await prisma.role.findUniqueOrThrow({ where: { key } });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({
        data: grants.map((permission) => ({ roleId: role.id, permission })),
      });
    }

    adminRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: "ADMIN" } })).id;
    userRoleId = (await prisma.role.findUniqueOrThrow({ where: { key: "USER" } })).id;

    const row = await prisma.user.create({
      data: {
        email: "admin@test.local",
        displayName: "Admin",
        role: "ADMIN",
        roleId: adminRoleId,
        color: "#2563eb",
      },
    });
    admin = actorFor(row, DEFAULT_GRANTS.ADMIN);
  });

  describe("the built-in roles", () => {
    it("start with exactly the access they had before permissions were editable", async () => {
      const roles = await listRoles();
      const byKey = new Map(roles.map((role) => [role.key, role]));

      expect(byKey.get("ADMIN")?.permissions.sort()).toEqual([...DEFAULT_GRANTS.ADMIN].sort());
      expect(byKey.get("MANAGER")?.permissions.sort()).toEqual(
        [...DEFAULT_GRANTS.MANAGER].sort(),
      );
      expect(byKey.get("USER")?.permissions).toEqual([]);
    });

    it("can have their permissions changed", async () => {
      const managerId = (await prisma.role.findUniqueOrThrow({ where: { key: "MANAGER" } })).id;
      const updated = await setRolePermissions(managerId, ["events.import"], admin);
      expect(updated.permissions).toEqual(["events.import"]);
    });

    it("cannot be deleted", async () => {
      await expect(deleteRole(userRoleId, admin)).rejects.toThrow(/cannot be deleted/i);
    });
  });

  describe("custom roles", () => {
    it("is created empty, so a new role grants nothing by accident", async () => {
      const role = await createRole({ name: "Shift Lead" }, admin);
      expect(role.permissions).toEqual([]);
      expect(role.key).toBe("SHIFT_LEAD");
      expect(role.isSystem).toBe(false);
    });

    it("refuses a name that collides with a built-in", async () => {
      await expect(createRole({ name: "admin" }, admin)).rejects.toThrow(/built-in/i);
    });

    it("refuses a duplicate", async () => {
      await createRole({ name: "Shift Lead" }, admin);
      await expect(createRole({ name: "shift lead" }, admin)).rejects.toThrow(/already exists/i);
    });

    it("refuses a name with nothing to build an id from", async () => {
      await expect(createRole({ name: "!!!" }, admin)).rejects.toThrow(/no letters or numbers/i);
    });

    it("keeps its key when renamed, so the audit trail still joins up", async () => {
      const role = await createRole({ name: "Shift Lead" }, admin);
      const renamed = await updateRole(role.id, { name: "Team Lead" }, admin);
      expect(renamed.name).toBe("Team Lead");
      expect(renamed.key).toBe("SHIFT_LEAD");
    });

    it("refuses a permission the code does not enforce", async () => {
      const role = await createRole({ name: "Shift Lead" }, admin);
      await expect(
        setRolePermissions(role.id, ["events.summonDragons"], admin),
      ).rejects.toThrow(/unknown permission/i);
    });

    it("cannot be deleted while somebody is in it", async () => {
      const role = await createRole({ name: "Shift Lead" }, admin);
      await prisma.user.create({
        data: {
          email: "lead@test.local",
          displayName: "Lead",
          role: "USER",
          roleId: role.id,
          color: "#059669",
        },
      });

      await expect(deleteRole(role.id, admin)).rejects.toThrow(/Move them to another role/i);
    });

    it("can be deleted once empty", async () => {
      const role = await createRole({ name: "Shift Lead" }, admin);
      await deleteRole(role.id, admin);
      expect(await prisma.role.findUnique({ where: { id: role.id } })).toBeNull();
    });
  });

  describe("locking yourself out", () => {
    it("refuses to strip the last administering role", async () => {
      // The whole reason this is enforced in the service: the screen you would
      // need to undo it on is the one you just closed.
      await expect(
        setRolePermissions(adminRoleId, ["events.import"], admin),
      ).rejects.toThrow(/nobody able to manage users and settings/i);
    });

    it("allows it once another role covers it", async () => {
      const rescue = await createRole(
        { name: "Owner", permissions: ["users.manage", "settings.manage"] },
        admin,
      );
      await prisma.user.create({
        data: {
          email: "owner@test.local",
          displayName: "Owner",
          role: "ADMIN",
          roleId: rescue.id,
          color: "#ca8a04",
        },
      });

      const stripped = await setRolePermissions(adminRoleId, ["events.import"], admin);
      expect(stripped.permissions).toEqual(["events.import"]);
    });

    it("does not count a role nobody holds as cover", async () => {
      // A perfectly configured role with no people in it administers nothing.
      await createRole(
        { name: "Owner", permissions: ["users.manage", "settings.manage"] },
        admin,
      );

      await expect(
        setRolePermissions(adminRoleId, ["events.import"], admin),
      ).rejects.toThrow(/nobody able to manage users and settings/i);
    });

    it("refuses to let somebody demote themselves out of administering", async () => {
      // Caught by the self-demotion guard before the last-administrator one,
      // and deliberately so: it holds even when other administrators exist,
      // because the person clicking is the one who would lose the screen.
      await expect(
        updateUser(admin.effective.id, { roleId: userRoleId }, admin),
      ).rejects.toThrow(/cannot take away your own permission/i);
    });

    it("refuses to move the last administrator, even by somebody else's hand", async () => {
      const second = await prisma.user.create({
        data: {
          email: "second@test.local",
          displayName: "Second",
          role: "ADMIN",
          roleId: adminRoleId,
          color: "#059669",
        },
      });
      const secondActor = actorFor(second, DEFAULT_GRANTS.ADMIN);

      // Demote the original first, which is allowed while two remain...
      await updateUser(admin.effective.id, { roleId: userRoleId }, secondActor);

      // ...and now the survivor cannot be demoted by anyone.
      const third = await prisma.user.create({
        data: {
          email: "third@test.local",
          displayName: "Third",
          role: "USER",
          roleId: userRoleId,
          color: "#ca8a04",
        },
      });
      const thirdActor = actorFor(third, DEFAULT_GRANTS.ADMIN);

      await expect(
        updateUser(second.id, { roleId: userRoleId }, thirdActor),
      ).rejects.toThrow(/last person who can manage users and settings/i);
    });

    it("refuses to deactivate the last administrator", async () => {
      await expect(
        updateUser(admin.effective.id, { active: false }, admin),
      ).rejects.toThrow(/cannot deactivate your own account/i);
    });

    it("lets one administrator move another once two exist", async () => {
      const other = await prisma.user.create({
        data: {
          email: "second@test.local",
          displayName: "Second",
          role: "ADMIN",
          roleId: adminRoleId,
          color: "#059669",
        },
      });

      const moved = await updateUser(other.id, { roleId: userRoleId }, admin);
      expect(moved).toBeDefined();

      const stored = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
      expect(stored.roleId).toBe(userRoleId);
    });
  });
});
