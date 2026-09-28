/**
 * User / employee management.
 *
 * Employees are database records, never a hard-coded list. Deactivation is the
 * only removal path: user rows are referenced by assignments, completions and
 * notes, and deleting one would erase the record of who did the work.
 */

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { assertRoleChangeIsSafe } from "./roles";
import { LOCKOUT_CRITICAL } from "@/lib/domain/permissions";
import {
  conflict,
  isUniqueViolation,
  notFound,
  validationError,
} from "@/lib/errors";
import {
  DEFAULT_USER_COLOR,
  isValidUserColor,
  normaliseUserColor,
  USER_COLOR_PALETTE,
  roleLabel,
  USER_ROLES,
  type UserRoleValue,
} from "@/lib/domain/constants";
import { auditActor, type ActorContext } from "@/lib/auth/actor";
import { diffChanges, recordAudit } from "./audit";

const BCRYPT_ROUNDS = 12;

export interface UserOption {
  id: string;
  displayName: string;
  email: string;
  active: boolean;
  color: string;
  role: UserRoleValue;
}

export interface ManagedUser extends UserOption {
  /** The role row, so the picker can preselect it. */
  roleId: string | null;
  /** What the role is called — the only name a custom role has. */
  roleName: string;
  /** Whether that role can manage users and settings — drives the badge. */
  canAdminister: boolean;
  createdAt: string;
  hasPassword: boolean;
  assignedEvents: number;
  assignedStages: number;
  clockifyUserId: string | null;
  excludeFromTimeReport: boolean;
  canStartCompleted: boolean;
}

/**
 * Users to render in assignee dropdowns: everyone active, plus any inactive
 * user still referenced by an assignment.
 *
 * Inactive users are included so their name and color still render on work
 * they already hold instead of the cell going blank. The UI offers only active
 * ones as choices, and the service layer refuses to assign an inactive
 * employee to anything new.
 */
export async function listSelectableUsers(): Promise<UserOption[]> {
  return prisma.user.findMany({
    where: {
      OR: [
        { active: true },
        { assignedEvents: { some: {} } },
        { assignedStages: { some: {} } },
      ],
    },
    select: {
      id: true,
      displayName: true,
      email: true,
      active: true,
      color: true,
      role: true,
    },
    orderBy: [{ active: "desc" }, { displayName: "asc" }],
  });
}

export async function listUsers(): Promise<ManagedUser[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { displayName: "asc" }],
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      active: true,
      color: true,
      createdAt: true,
      passwordHash: true,
      clockifyUserId: true,
      excludeFromTimeReport: true,
      canStartCompleted: true,
      roleId: true,
      roleRef: {
        select: { name: true, permissions: { select: { permission: true } } },
      },
      _count: { select: { assignedEvents: true, assignedStages: true } },
    },
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    roleId: user.roleId,
    roleName: user.roleRef?.name ?? roleLabel(user.role),
    // "Administrator" is now a capability rather than a name, so this asks the
    // question the badge is really about: can this person administer?
    canAdminister: LOCKOUT_CRITICAL.every((permission) =>
      (user.roleRef?.permissions ?? []).some((row) => row.permission === permission),
    ),
    active: user.active,
    color: user.color,
    createdAt: user.createdAt.toISOString(),
    hasPassword: user.passwordHash !== null,
    assignedEvents: user._count.assignedEvents,
    assignedStages: user._count.assignedStages,
    clockifyUserId: user.clockifyUserId,
    excludeFromTimeReport: user.excludeFromTimeReport,
    canStartCompleted: user.canStartCompleted,
  }));
}

/**
 * Picks the least-used palette color, so a new teammate is visually distinct
 * from everyone already on screen without the administrator having to think
 * about it.
 */
async function suggestColor(): Promise<string> {
  const used = await prisma.user.findMany({ select: { color: true } });
  const counts = new Map<string, number>(
    USER_COLOR_PALETTE.map((color) => [color, 0]),
  );

  for (const { color } of used) {
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }

  let best = DEFAULT_USER_COLOR;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const color of USER_COLOR_PALETTE) {
    const count = counts.get(color) ?? 0;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }

  return best;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  /** The role row this user belongs to. */
  roleId: string;
  active?: boolean;
  color?: string;
  password?: string;
}


/**
 * A value for the legacy `users.role` enum column.
 *
 * Nothing reads it — permissions come from the role row — but it is NOT NULL
 * and the previous release did read it, so it is kept in step for the built-in
 * roles and parked at USER for custom ones. A custom role has no enum value by
 * definition, and inventing one would be a lie that a rollback would believe.
 */
function legacyEnumFor(key: string): UserRoleValue {
  return (USER_ROLES as readonly string[]).includes(key)
    ? (key as UserRoleValue)
    : "USER";
}

/** Refuses to deactivate the last person who can administer the site. */
async function assertDeactivationIsSafe(userId: string): Promise<void> {
  const administering = await prisma.role.findMany({
    where: {
      AND: LOCKOUT_CRITICAL.map((permission) => ({ permissions: { some: { permission } } })),
    },
    select: { users: { where: { active: true }, select: { id: true } } },
  });

  const othersRemain = administering.some((role) =>
    role.users.some((other) => other.id !== userId),
  );

  if (!othersRemain) {
    throw validationError(
      "There must be at least one active person who can manage users and settings.",
    );
  }
}
export async function createUser(input: CreateUserInput, actor: ActorContext) {
  const role = await prisma.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw validationError("Choose a role for this user.");

  const color = input.color ? normaliseUserColor(input.color) : await suggestColor();
  if (!isValidUserColor(color)) {
    throw validationError("Color must be a hex value such as #2563eb.");
  }

  try {
    const user = await prisma.user.create({
      data: {
        email: input.email.trim().toLowerCase(),
        displayName: input.displayName.trim(),
        role: legacyEnumFor(role.key),
        roleId: role.id,
        active: input.active ?? true,
        color,
        passwordHash: input.password
          ? await bcrypt.hash(input.password, BCRYPT_ROUNDS)
          : null,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        active: true,
        color: true,
      },
    });

    await recordAudit({
      ...auditActor(actor),
      entityType: "USER",
      entityId: user.id,
      action: "CREATED",
      newValue: { email: user.email, displayName: user.displayName, role: user.role },
    });

    return user;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("A user with that email address already exists.");
    }
    throw error;
  }
}

export interface UpdateUserInput {
  email?: string;
  displayName?: string;
  roleId?: string;
  active?: boolean;
  color?: string;
  password?: string;
  /** Clockify user id, or `null` to unlink. */
  clockifyUserId?: string | null;
  excludeFromTimeReport?: boolean;
  canStartCompleted?: boolean;
}

export async function updateUser(
  userId: string,
  input: UpdateUserInput,
  actor: ActorContext,
) {
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    include: { roleRef: { include: { permissions: { select: { permission: true } } } } },
  });
  if (!existing) throw notFound("That user no longer exists.");

  /*
   * What the user is becoming, resolved before anything is judged: every guard
   * below needs the target role's grants, not merely the fact that the role
   * changed.
   */
  const nextRole = input.roleId
    ? await prisma.role.findUnique({
        where: { id: input.roleId },
        include: { permissions: { select: { permission: true } } },
      })
    : null;
  if (input.roleId && !nextRole) throw validationError("That role no longer exists.");

  const actingAs = actor.real.id;

  // Guard against an administrator locking themselves — and potentially
  // everyone — out of user management.
  if (userId === actingAs) {
    if (input.active === false) {
      throw validationError("You cannot deactivate your own account.");
    }
    if (nextRole) {
      // Taking your own administering permissions away is the same mistake as
      // deleting the last administrator, and just as hard to undo.
      const keepsAdministering = LOCKOUT_CRITICAL.every((permission) =>
        nextRole.permissions.some((row) => row.permission === permission),
      );
      const hadAdministering = LOCKOUT_CRITICAL.every((permission) =>
        (existing.roleRef?.permissions ?? []).some((row) => row.permission === permission),
      );
      if (hadAdministering && !keepsAdministering) {
        throw validationError(
          "You cannot take away your own permission to manage users and settings.",
        );
      }
    }
  }

  // Moving the last administrator out of an administering role locks the site
  // exactly as thoroughly as unticking the permission, so the same guard runs.
  if (nextRole) await assertRoleChangeIsSafe(userId, nextRole.id);

  if (existing.active && input.active === false) {
    await assertDeactivationIsSafe(userId);
  }

  const color = input.color ? normaliseUserColor(input.color) : undefined;
  if (color !== undefined && !isValidUserColor(color)) {
    throw validationError("Color must be a hex value such as #2563eb.");
  }

  try {
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.email !== undefined
          ? { email: input.email.trim().toLowerCase() }
          : {}),
        ...(input.displayName !== undefined
          ? { displayName: input.displayName.trim() }
          : {}),
        ...(nextRole ? { roleId: nextRole.id, role: legacyEnumFor(nextRole.key) } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(input.clockifyUserId !== undefined
          ? { clockifyUserId: input.clockifyUserId?.trim() || null }
          : {}),
        ...(input.excludeFromTimeReport !== undefined
          ? { excludeFromTimeReport: input.excludeFromTimeReport }
          : {}),
        ...(input.canStartCompleted !== undefined
          ? { canStartCompleted: input.canStartCompleted }
          : {}),
        ...(input.password
          ? { passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS) }
          : {}),
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        active: true,
        color: true,
      },
    });

    const changes = diffChanges(
      {
        email: existing.email,
        displayName: existing.displayName,
        role: existing.role,
        active: existing.active,
        color: existing.color,
      },
      {
        ...(input.email !== undefined ? { email: user.email } : {}),
        ...(input.displayName !== undefined ? { displayName: user.displayName } : {}),
        ...(nextRole ? { role: nextRole.name } : {}),
        ...(input.active !== undefined ? { active: user.active } : {}),
        ...(color !== undefined ? { color: user.color } : {}),
      },
    );

    if (changes || input.password) {
      await recordAudit({
        ...auditActor(actor),
        entityType: "USER",
        entityId: userId,
        action: input.password ? "PASSWORD_CHANGED" : "UPDATED",
        oldValue: changes?.old,
        newValue: changes?.new,
      });
    }

    return user;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("A user with that email address already exists.");
    }
    throw error;
  }
}

/** Impersonation targets: active users other than the administrator themselves. */
export async function listImpersonationTargets(
  adminId: string,
): Promise<Array<UserOption & { roleName: string }>> {
  const rows = await prisma.user.findMany({
    where: { active: true, id: { not: adminId } },
    select: {
      id: true,
      displayName: true,
      email: true,
      active: true,
      color: true,
      role: true,
      roleRef: { select: { name: true } },
    },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
  });

  // The menu shows what each person's role is *called*, which for a custom role
  // is the only name it has.
  return rows.map((row) => ({
    ...row,
    roleName: row.roleRef?.name ?? roleLabel(row.role),
  }));
}
