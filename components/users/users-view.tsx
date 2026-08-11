"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  StatPill,
  UserChip,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { cn } from "@/lib/ui/cn";
import { formatBusinessTimestamp } from "@/lib/date/business-time";
import {
  readableTextColor,
  roleLabel,
  USER_COLOR_PALETTE,
  USER_ROLES,
  type UserRoleValue,
} from "@/lib/domain/constants";
import type { ManagedUser } from "@/lib/services/users";

export interface ClockifyOption {
  id: string;
  name: string;
  email: string;
}

interface FormState {
  displayName: string;
  email: string;
  role: UserRoleValue;
  active: boolean;
  color: string;
  password: string;
  clockifyUserId: string;
  excludeFromTimeReport: boolean;
}

const EMPTY: FormState = {
  displayName: "",
  email: "",
  role: "USER",
  active: true,
  color: USER_COLOR_PALETTE[0],
  password: "",
  clockifyUserId: "",
  excludeFromTimeReport: false,
};

const ROLE_DESCRIPTIONS: Record<UserRoleValue, string> = {
  ADMIN: "Everything, including users, settings and viewing as other people.",
  MANAGER: "All operational work, plus assigning events to other people.",
  USER: "Operational work. Can claim unassigned work or release their own.",
};

export function UsersView({
  users,
  clockifyUsers,
  currentUserId,
  googleEnabled,
}: {
  users: ManagedUser[];
  clockifyUsers: ClockifyOption[];
  currentUserId: string;
  googleEnabled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [editing, setEditing] = React.useState<ManagedUser | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);

  const activeCount = users.filter((user) => user.active).length;
  const adminCount = users.filter((u) => u.active && u.role === "ADMIN").length;
  const managerCount = users.filter((u) => u.active && u.role === "MANAGER").length;

  async function toggleActive(user: ManagedUser) {
    const activating = !user.active;

    if (
      !activating &&
      !window.confirm(
        `Deactivate ${user.displayName}?\n\nThey will no longer be selectable for new assignments and cannot sign in. Their existing assignments, completions and notes are kept.`,
      )
    ) {
      return;
    }

    setTogglingId(user.id);
    try {
      await api.patch(`/api/users/${user.id}`, { active: activating });
      toast.success(activating ? "User reactivated." : "User deactivated.");
      router.refresh();
    } catch (error) {
      toast.error(
        "Unable to update user.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <Card>
      <PageHeader
        title="Users & Roles"
        subtitle={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatPill label="active" value={activeCount} />
            <StatPill label="administrators" value={adminCount} />
            <StatPill label="managers" value={managerCount} />
            <span className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              Deactivate rather than delete — history stays intact.
            </span>
          </div>
        }
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Add user
          </Button>
        }
      />

      <div
        className="grid gap-2 border-b px-5 py-3 md:grid-cols-3"
        style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
      >
        {USER_ROLES.map((role) => (
          <div key={role} className="text-[11.5px]">
            <Badge tone={role === "ADMIN" ? "accent" : role === "MANAGER" ? "warn" : "neutral"}>
              {roleLabel(role)}
            </Badge>
            <p className="mt-1" style={{ color: "var(--ink-muted)" }}>
              {ROLE_DESCRIPTIONS[role]}
            </p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[980px] border-collapse text-left">
          <thead style={{ background: "var(--canvas)" }}>
            <tr>
              {["Name", "Email", "Role", "Status", "Sign-in", "Assignments", "Created", ""].map(
                (label, index) => (
                  <th
                    key={label || index}
                    className={cn(
                      "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide",
                      index === 7 && "text-right",
                    )}
                    style={{ color: "var(--ink-subtle)" }}
                  >
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr
                key={user.id}
                className="border-t"
                style={{ borderColor: "var(--line)", opacity: user.active ? 1 : 0.6 }}
              >
                <td className="px-3 py-2.5 text-[12.5px] font-medium">
                  <UserChip name={user.displayName} color={user.color} />
                  {user.id === currentUserId ? (
                    <Badge className="ml-1.5">You</Badge>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
                  {user.email}
                </td>
                <td className="px-3 py-2.5">
                  <Badge
                    tone={
                      user.role === "ADMIN"
                        ? "accent"
                        : user.role === "MANAGER"
                          ? "warn"
                          : "neutral"
                    }
                  >
                    {roleLabel(user.role)}
                  </Badge>
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={user.active ? "success" : "neutral"}>
                    {user.active ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="px-3 py-2.5 text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
                  {user.hasPassword
                    ? "Password"
                    : googleEnabled
                      ? "Google only"
                      : "No sign-in method"}
                </td>
                <td className="px-3 py-2.5 text-[12.5px] tabular-nums">
                  {user.assignedEvents + user.assignedStages}
                </td>
                <td className="px-3 py-2.5 text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
                  {formatBusinessTimestamp(user.createdAt)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(user)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={togglingId === user.id}
                      disabled={user.id === currentUserId}
                      title={
                        user.id === currentUserId
                          ? "You cannot deactivate your own account."
                          : undefined
                      }
                      onClick={() => toggleActive(user)}
                    >
                      {user.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <UserFormDialog
        open={creating || editing !== null}
        user={editing}
        clockifyUsers={clockifyUsers}
        googleEnabled={googleEnabled}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          router.refresh();
        }}
      />
    </Card>
  );
}

function UserFormDialog({
  open,
  user,
  clockifyUsers,
  googleEnabled,
  onClose,
  onSaved,
}: {
  open: boolean;
  user: ManagedUser | null;
  clockifyUsers: ClockifyOption[];
  googleEnabled: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setFieldErrors({});
    setFormError(null);
    setForm(
      user
        ? {
            displayName: user.displayName,
            email: user.email,
            role: user.role,
            active: user.active,
            color: user.color,
            password: "",
            clockifyUserId: user.clockifyUserId ?? "",
            excludeFromTimeReport: user.excludeFromTimeReport,
          }
        : EMPTY,
    );
  }, [open, user]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    setFormError(null);
    setPending(true);

    try {
      const payload: Record<string, unknown> = {
        displayName: form.displayName.trim(),
        email: form.email.trim().toLowerCase(),
        role: form.role,
        active: form.active,
        color: form.color,
        clockifyUserId: form.clockifyUserId.trim() || null,
        excludeFromTimeReport: form.excludeFromTimeReport,
      };

      // An empty password field on edit means "leave it alone", never "clear it".
      if (form.password) payload.password = form.password;

      if (user !== null) {
        await api.patch(`/api/users/${user.id}`, payload);
        toast.success("User updated.");
      } else {
        await api.post("/api/users", payload);
        toast.success("User created.");
      }
      onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFieldErrors(error.fieldErrors ?? {});
        setFormError(error.fieldErrors ? null : error.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={user ? "Edit user" : "Add user"}
      description={
        user
          ? "Deactivating keeps all historical assignments, completions and notes."
          : "New users can sign in as soon as they have a password."
      }
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" variant="primary" loading={pending}>
            {user ? "Save changes" : "Create user"}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={onSubmit} className="space-y-4">
        <Field label="Name" htmlFor="displayName" required errors={fieldErrors.displayName}>
          <Input
            id="displayName"
            required
            value={form.displayName}
            onChange={(event) => update("displayName", event.target.value)}
          />
        </Field>

        <Field label="Email" htmlFor="email" required errors={fieldErrors.email}>
          <Input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={(event) => update("email", event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Role"
            htmlFor="role"
            errors={fieldErrors.role}
            hint={ROLE_DESCRIPTIONS[form.role]}
          >
            <Select
              id="role"
              value={form.role}
              onChange={(event) => update("role", event.target.value as UserRoleValue)}
            >
              {USER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Status" htmlFor="active">
            <Select
              id="active"
              value={form.active ? "true" : "false"}
              onChange={(event) => update("active", event.target.value === "true")}
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
          </Field>
        </div>

        <Field
          label="Color"
          errors={fieldErrors.color}
          hint="Shown as a dot beside this person's name everywhere. The name is always shown too, so color is never the only cue."
        >
          <div className="flex flex-wrap gap-1.5">
            {USER_COLOR_PALETTE.map((color) => {
              const selected = form.color === color;
              return (
                <button
                  key={color}
                  type="button"
                  aria-label={color}
                  aria-pressed={selected}
                  onClick={() => update("color", color)}
                  className={cn(
                    "h-7 w-7 rounded-full border-2 transition",
                    selected ? "scale-110" : "opacity-70 hover:opacity-100",
                  )}
                  style={{
                    background: color,
                    borderColor: selected ? "var(--ink)" : "transparent",
                    color: readableTextColor(color),
                  }}
                >
                  {selected ? "✓" : ""}
                </button>
              );
            })}
          </div>
        </Field>

        <Field
          label="Clockify user"
          htmlFor="clockifyUserId"
          errors={fieldErrors.clockifyUserId}
          hint={
            clockifyUsers.length > 0
              ? "Links this person to their Clockify account so their time shows in the header."
              : "Clockify is off or unreachable, so paste the Clockify user id directly if you have it."
          }
        >
          {clockifyUsers.length > 0 ? (
            <Select
              id="clockifyUserId"
              value={form.clockifyUserId}
              onChange={(event) => update("clockifyUserId", event.target.value)}
            >
              <option value="">Not linked</option>
              {clockifyUsers.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} ({option.email})
                </option>
              ))}
            </Select>
          ) : (
            <Input
              id="clockifyUserId"
              value={form.clockifyUserId}
              onChange={(event) => update("clockifyUserId", event.target.value)}
              placeholder="Clockify user id (optional)"
            />
          )}
        </Field>

        <label className="flex cursor-pointer items-start gap-2 text-[12.5px]">
          <input
            type="checkbox"
            checked={form.excludeFromTimeReport}
            onChange={(event) => update("excludeFromTimeReport", event.target.checked)}
            style={{ accentColor: "var(--accent)" }}
            className="mt-0.5 h-3.5 w-3.5"
          />
          <span>
            Exclude from the hours-worked chart
            <span className="block text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              For owners and administrators whose hours are not comparable to
              operational staff. They still appear in every other metric.
            </span>
          </span>
        </label>

        <Field
          label={user ? "New password" : "Password"}
          htmlFor="password"
          errors={fieldErrors.password}
          hint={
            user
              ? "Leave blank to keep the current password."
              : googleEnabled
                ? "Optional — leave blank to allow Google sign-in only."
                : "At least 10 characters. Required for this user to sign in."
          }
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(event) => update("password", event.target.value)}
          />
        </Field>

        {formError ? (
          <p
            role="alert"
            className="rounded-md border px-2.5 py-2 text-[12px]"
            style={{
              background: "var(--danger-soft)",
              color: "var(--danger)",
              borderColor: "transparent",
            }}
          >
            {formError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
