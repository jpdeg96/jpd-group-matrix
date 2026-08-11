/**
 * User / employee management.
 *
 * Employees are database records, never a hard-coded list. Deactivation is the
 * only removal path: user rows are referenced by assignments, completions and
 * notes, and deleting one would erase the record of who did the work.
 */

import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
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
  createdAt: string;
  hasPassword: boolean;
  assignedEvents: number;
  assignedStages: number;
  clockifyUserId: string | null;
  excludeFromTimeReport: boolean;
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
      _count: { select: { assignedEvents: true, assignedStages: true } },
    },
  });

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
    color: user.color,
    createdAt: user.createdAt.toISOString(),
    hasPassword: user.passwordHash !== null,
    assignedEvents: user._count.assignedEvents,
    assignedStages: user._count.assignedStages,
    clockifyUserId: user.clockifyUserId,
    excludeFromTimeReport: user.excludeFromTimeReport,
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
  role?: UserRoleValue;
  active?: boolean;
  color?: string;
  password?: string;
}

export async function createUser(input: CreateUserInput, actor: ActorContext) {
  const color = input.color ? normaliseUserColor(input.color) : await suggestColor();
  if (!isValidUserColor(color)) {
    throw validationError("Color must be a hex value such as #2563eb.");
  }

  try {
    const user = await prisma.user.create({
      data: {
        email: input.email.trim().toLowerCase(),
        displayName: input.displayName.trim(),
        role: input.role ?? "USER",
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
  role?: UserRoleValue;
  active?: boolean;
  color?: string;
  password?: string;
  /** Clockify user id, or `null` to unlink. */
  clockifyUserId?: string | null;
  excludeFromTimeReport?: boolean;
}

export async function updateUser(
  userId: string,
  input: UpdateUserInput,
  actor: ActorContext,
) {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw notFound("That user no longer exists.");

  const actingAs = actor.real.id;

  // Guard against an administrator locking themselves — and potentially
  // everyone — out of user management.
  if (userId === actingAs) {
    if (input.active === false) {
      throw validationError("You cannot deactivate your own account.");
    }
    if (input.role !== undefined && input.role !== "ADMIN" && existing.role === "ADMIN") {
      throw validationError("You cannot remove your own administrator role.");
    }
  }

  const losingAdmin =
    existing.role === "ADMIN" &&
    existing.active &&
    (input.active === false || (input.role !== undefined && input.role !== "ADMIN"));

  if (losingAdmin) {
    const otherAdmins = await prisma.user.count({
      where: { role: "ADMIN", active: true, id: { not: userId } },
    });
    if (otherAdmins === 0) {
      throw validationError("There must be at least one active administrator.");
    }
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
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(input.clockifyUserId !== undefined
          ? { clockifyUserId: input.clockifyUserId?.trim() || null }
          : {}),
        ...(input.excludeFromTimeReport !== undefined
          ? { excludeFromTimeReport: input.excludeFromTimeReport }
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
        ...(input.role !== undefined ? { role: user.role } : {}),
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
): Promise<UserOption[]> {
  return prisma.user.findMany({
    where: { active: true, id: { not: adminId } },
    select: {
      id: true,
      displayName: true,
      email: true,
      active: true,
      color: true,
      role: true,
    },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
  });
}
