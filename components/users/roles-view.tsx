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
  Textarea,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import {
  PERMISSION_GROUPS,
  PERMISSIONS,
  type Permission,
} from "@/lib/domain/permissions";
import type { RoleView } from "@/lib/services/roles";

/**
 * The permission matrix.
 *
 * A grid rather than a form per role, because the question people arrive with
 * is comparative — "who can send remittance?" — and a form answers it one role
 * at a time. Reading across a row answers it at a glance.
 *
 * Each tick saves on the click. One Save button over eighty checkboxes is a
 * screen where you lose work by navigating away; here every change is a single
 * box the server has already accepted or refused, and a refusal puts the box
 * back with the reason.
 */
export function RolesView({ roles: initial }: { roles: RoleView[] }) {
  const router = useRouter();
  const toast = useToast();

  const [roles, setRoles] = React.useState(initial);
  const [saving, setSaving] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<RoleView | null>(null);

  React.useEffect(() => setRoles(initial), [initial]);

  async function toggle(role: RoleView, permission: Permission) {
    const held = role.permissions.includes(permission);
    const next = held
      ? role.permissions.filter((key) => key !== permission)
      : [...role.permissions, permission];

    const previous = roles;
    setRoles((current) =>
      current.map((item) => (item.id === role.id ? { ...item, permissions: next } : item)),
    );
    setSaving(`${role.id}:${permission}`);

    try {
      const result = await api.patch<{ role: RoleView }>(`/api/roles/${role.id}`, {
        permissions: next,
      });
      setRoles((current) =>
        current.map((item) => (item.id === role.id ? result.role : item)),
      );
      router.refresh();
    } catch (error) {
      setRoles(previous);
      toast.error(
        "Could not change that permission.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setSaving(null);
    }
  }

  async function remove(role: RoleView) {
    const confirmed = window.confirm(
      `Delete the "${role.name}" role?\n\nThis cannot be undone. Anyone who had it must already have been moved elsewhere.`,
    );
    if (!confirmed) return;

    try {
      await api.delete(`/api/roles/${role.id}`);
      toast.success(`"${role.name}" deleted.`);
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not delete that role.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    }
  }

  return (
    <Card>
      <PageHeader
        title="Roles & Permissions"
        subtitle={
          <span className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
            Tick what each role may do. Changes take effect on that person&rsquo;s
            next request — nobody has to sign out. Everyone can always work their
            own assignments; these are the permissions beyond that.
          </span>
        }
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Add role
          </Button>
        }
      />

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-collapse text-left">
          <thead
            className="sticky top-0 z-10"
            style={{ background: "var(--surface)", boxShadow: "0 1px 0 var(--line)" }}
          >
            <tr>
              <th
                className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: "var(--ink-subtle)", minWidth: "22rem" }}
              >
                Permission
              </th>
              {roles.map((role) => (
                <th
                  key={role.id}
                  className="px-3 py-2 text-center align-top"
                  style={{ minWidth: "8.5rem" }}
                >
                  <span className="block text-[12.5px] font-semibold">{role.name}</span>
                  <span
                    className="block text-[10.5px] font-normal"
                    style={{ color: "var(--ink-subtle)" }}
                  >
                    {role.userCount} {role.userCount === 1 ? "person" : "people"}
                  </span>
                  <span className="mt-1 flex items-center justify-center gap-1.5">
                    {role.isSystem ? (
                      <Badge>Built-in</Badge>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditing(role)}
                          className="text-[10.5px] font-normal underline-offset-2 hover:underline"
                          style={{ color: "var(--ink-subtle)" }}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(role)}
                          className="text-[10.5px] font-normal underline-offset-2 hover:underline"
                          style={{ color: "var(--danger)" }}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {PERMISSION_GROUPS.map((group) => {
              const rows = PERMISSIONS.filter((entry) => entry.group === group);
              if (rows.length === 0) return null;

              return (
                <React.Fragment key={group}>
                  <tr>
                    <td
                      colSpan={roles.length + 1}
                      className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ background: "var(--canvas)", color: "var(--ink-subtle)" }}
                    >
                      {group}
                    </td>
                  </tr>

                  {rows.map((entry) => (
                    <tr
                      key={entry.key}
                      className="border-t"
                      style={{ borderColor: "var(--line)" }}
                    >
                      <td className="px-4 py-2 align-top">
                        <span className="block text-[12.5px]">{entry.label}</span>
                        {"detail" in entry && entry.detail ? (
                          <span
                            className="block text-[11px]"
                            style={{ color: "var(--ink-subtle)" }}
                          >
                            {entry.detail}
                          </span>
                        ) : null}
                      </td>

                      {roles.map((role) => (
                        <td key={role.id} className="px-3 py-2 text-center align-top">
                          <input
                            type="checkbox"
                            aria-label={`${entry.label} — ${role.name}`}
                            checked={role.permissions.includes(entry.key)}
                            disabled={saving === `${role.id}:${entry.key}`}
                            onChange={() => toggle(role, entry.key)}
                            style={{ accentColor: "var(--accent)" }}
                            className="h-4 w-4 disabled:opacity-50"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {creating ? (
        <RoleDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      ) : null}

      {editing ? (
        <RoleDialog
          role={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </Card>
  );
}

/** Create a role, or rename one. Its permissions are ticked in the grid. */
function RoleDialog({
  role,
  onClose,
  onSaved,
}: {
  role?: RoleView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = React.useState(role?.name ?? "");
  const [description, setDescription] = React.useState(role?.description ?? "");
  const [pending, setPending] = React.useState(false);

  async function save() {
    setPending(true);
    try {
      if (role) {
        await api.patch(`/api/roles/${role.id}`, { name, description });
        toast.success("Role updated.");
      } else {
        await api.post("/api/roles", { name, description });
        toast.success(`"${name.trim()}" created. Tick what it may do.`);
      }
      onSaved();
    } catch (error) {
      toast.error(
        role ? "Could not update that role." : "Could not create that role.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={role ? `Rename ${role.name}` : "Add a role"}
      description={
        role
          ? "The internal id stays as it is, so the audit trail keeps joining up."
          : "It starts with no permissions. Tick what it may do in the grid, then move people into it from the list below."
      }
      width="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!name.trim()}
            onClick={save}
          >
            {role ? "Save" : "Create role"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" htmlFor="roleName">
          <Input
            id="roleName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Shift Lead"
            autoFocus
          />
        </Field>
        <Field label="What it is for" htmlFor="roleDescription">
          <Textarea
            id="roleDescription"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional — a line to remind whoever reads this later."
          />
        </Field>
      </div>
    </Dialog>
  );
}
