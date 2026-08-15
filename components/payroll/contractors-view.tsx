"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  StatPill,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import {
  PAY_TYPE_LABELS,
  PAY_TYPES,
  formatMoney,
  formatRate,
  type PayType,
} from "@/lib/domain/payroll-format";

interface Contractor {
  id: string;
  name: string;
  payType: PayType;
  weeklyAmount: string | null;
  hourlyRate: string | null;
  invoicePrefix: string;
  active: boolean;
  remittanceEmail: string | null;
  clockifyUserId: string | null;
  linkedUserName: string | null;
  invoiceCount: number;
  notes: string | null;
}

interface SeedableUser {
  id: string;
  displayName: string;
  email: string;
  clockifyUserId: string | null;
  suggestedPrefix: string;
  clockifyLinked: boolean;
}

export function ContractorsView({
  contractors,
  seedable,
}: {
  contractors: Contractor[];
  seedable: SeedableUser[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<Contractor | null>(null);
  const [busy, setBusy] = React.useState(false);

  const active = contractors.filter((contractor) => contractor.active);

  async function deactivate(contractor: Contractor) {
    setBusy(true);
    try {
      await api.delete(`/api/payroll/contractors/${contractor.id}`);
      toast.success(`${contractor.name} deactivated.`);
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not deactivate.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <PageHeader
        title="Contractors"
        subtitle={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatPill label="active" value={active.length} />
            <span className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              Rates apply from the next import. Weeks already approved keep the rate they
              were approved at.
            </span>
          </div>
        }
        actions={
          seedable.length > 0 ? (
            <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
              Add from users ({seedable.length})
            </Button>
          ) : null
        }
      />

      {contractors.length === 0 ? (
        <EmptyState
          title="No contractors yet"
          description="Add them from your existing user accounts — name, Clockify link and email come across automatically."
        />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1000px] border-collapse text-left">
            <thead style={{ background: "var(--canvas)" }}>
              <tr>
                {["Contractor", "Prefix", "Pay type", "Rate", "Clockify", "Email", "Invoices", ""].map(
                  (label, index) => (
                    <th
                      key={label || index}
                      className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: "var(--ink-subtle)" }}
                    >
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {contractors.map((contractor) => (
                <tr
                  key={contractor.id}
                  className="border-t"
                  style={{ borderColor: "var(--line)", opacity: contractor.active ? 1 : 0.6 }}
                >
                  <td className="px-3 py-2 text-[12.5px] font-medium">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {contractor.name}
                      {!contractor.active ? <Badge>inactive</Badge> : null}
                    </span>
                    {contractor.linkedUserName ? (
                      <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-subtle)" }}>
                        linked to {contractor.linkedUserName}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px]">{contractor.invoicePrefix}</td>
                  <td className="px-3 py-2 text-[12px]" style={{ color: "var(--ink-muted)" }}>
                    {PAY_TYPE_LABELS[contractor.payType]}
                  </td>
                  <td className="px-3 py-2 text-right text-[12.5px] tabular-nums">
                    {contractor.payType === "HOURLY"
                      ? `$${formatRate(contractor.hourlyRate ?? "0")}/h`
                      : `$${formatMoney(contractor.weeklyAmount ?? "0")}/wk`}
                  </td>
                  <td className="px-3 py-2 text-[11.5px]">
                    {contractor.clockifyUserId ? (
                      <span style={{ color: "var(--success)" }}>linked</span>
                    ) : (
                      // Worth naming: an hourly contractor with no Clockify
                      // link imports zero hours and would be paid nothing.
                      <span style={{ color: "var(--warn)" }}>not linked</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
                    {contractor.remittanceEmail ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-[12px] tabular-nums">
                    {contractor.invoiceCount}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(contractor)}
                        className="rounded border px-2 py-0.5 text-[11px] font-medium"
                        style={{ borderColor: "var(--line-strong)", color: "var(--ink-muted)" }}
                      >
                        Edit
                      </button>
                      {contractor.active ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => deactivate(contractor)}
                          className="rounded border px-2 py-0.5 text-[11px] font-medium disabled:opacity-50"
                          style={{ borderColor: "var(--line-strong)", color: "var(--danger)" }}
                          title="Removes them from future imports. Payment history is kept."
                        >
                          Deactivate
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <SeedDialog
          users={seedable}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      ) : null}

      {editing ? (
        <EditDialog
          contractor={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </Card>
  );
}

/**
 * Adding contractors from user accounts.
 *
 * Name, Clockify id and email come from the user record rather than being
 * retyped, so the two cannot drift. Only the pay type and rate are asked for —
 * nothing on a user says what somebody earns.
 */
function SeedDialog({
  users,
  onClose,
  onDone,
}: {
  users: SeedableUser[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [chosen, setChosen] = React.useState<Record<string, { payType: PayType; rate: string; prefix: string }>>({});

  function toggle(user: SeedableUser) {
    setChosen((current) => {
      const next = { ...current };
      if (next[user.id]) delete next[user.id];
      else next[user.id] = { payType: "HOURLY", rate: "", prefix: user.suggestedPrefix };
      return next;
    });
  }

  const selected = Object.entries(chosen);
  const incomplete = selected.some(([, value]) => value.rate.trim() === "");

  async function submit() {
    setBusy(true);
    try {
      const { result } = await api.post<{
        result: { created: string[]; skipped: { name: string; reason: string }[] };
      }>("/api/payroll/seed-contractors", {
        people: selected.map(([userId, value]) => ({
          userId,
          payType: value.payType,
          weeklyAmount: value.payType === "FLAT_WEEKLY" ? value.rate.trim() : undefined,
          hourlyRate: value.payType === "HOURLY" ? value.rate.trim() : undefined,
          invoicePrefix: value.prefix,
        })),
      });

      if (result.created.length > 0) {
        toast.success(`Added ${result.created.join(", ")}.`);
      }
      for (const skip of result.skipped) {
        toast.error(`${skip.name}: ${skip.reason}`);
      }
      onDone();
    } catch (error) {
      toast.error(
        "Could not add contractors.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add contractors from users"
      description="Name, Clockify link and email come across automatically. Set how each person is paid."
      width="lg"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={selected.length === 0 || incomplete}
            onClick={submit}
            title={incomplete ? "Every selected person needs a rate" : undefined}
          >
            Add {selected.length > 0 ? selected.length : ""}
          </Button>
        </>
      }
    >
      <ul className="space-y-2">
        {users.map((user) => {
          const picked = chosen[user.id];

          return (
            <li
              key={user.id}
              className="rounded-md border px-3 py-2"
              style={{ borderColor: picked ? "var(--accent)" : "var(--line)" }}
            >
              <label className="flex flex-wrap items-center gap-2">
                <input type="checkbox" checked={Boolean(picked)} onChange={() => toggle(user)} />
                <span className="text-[12.5px] font-medium">{user.displayName}</span>
                <span className="text-[11px]" style={{ color: "var(--ink-subtle)" }}>
                  {user.email}
                </span>
                {!user.clockifyLinked ? (
                  <span className="text-[11px]" style={{ color: "var(--warn)" }}>
                    no Clockify link — hours will import as zero
                  </span>
                ) : null}
              </label>

              {picked ? (
                <div className="mt-2 flex flex-wrap items-end gap-2 pl-6">
                  <Field label="Pay type">
                    <select
                      value={picked.payType}
                      onChange={(event) =>
                        setChosen((current) => ({
                          ...current,
                          [user.id]: { ...picked, payType: event.target.value as PayType },
                        }))
                      }
                      className="rounded-md border px-2 py-1 text-[12px]"
                      style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
                    >
                      {PAY_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {PAY_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={picked.payType === "HOURLY" ? "Hourly rate" : "Weekly amount"}>
                    <input
                      value={picked.rate}
                      onChange={(event) =>
                        setChosen((current) => ({
                          ...current,
                          [user.id]: { ...picked, rate: event.target.value },
                        }))
                      }
                      placeholder={picked.payType === "HOURLY" ? "3.13" : "750.00"}
                      className="w-28 rounded-md border px-2 py-1 text-[12px] tabular-nums"
                      style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
                    />
                  </Field>

                  <Field label="Invoice prefix" hint="Appears on every invoice.">
                    <input
                      value={picked.prefix}
                      onChange={(event) =>
                        setChosen((current) => ({
                          ...current,
                          [user.id]: { ...picked, prefix: event.target.value.toUpperCase() },
                        }))
                      }
                      className="w-24 rounded-md border px-2 py-1 font-mono text-[12px]"
                      style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
                    />
                  </Field>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

function EditDialog({
  contractor,
  onClose,
  onDone,
}: {
  contractor: Contractor;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [payType, setPayType] = React.useState<PayType>(contractor.payType);
  const [rate, setRate] = React.useState(
    contractor.payType === "HOURLY" ? (contractor.hourlyRate ?? "") : (contractor.weeklyAmount ?? ""),
  );
  const [prefix, setPrefix] = React.useState(contractor.invoicePrefix);
  const [email, setEmail] = React.useState(contractor.remittanceEmail ?? "");
  const [active, setActive] = React.useState(contractor.active);

  async function submit() {
    setBusy(true);
    try {
      await api.patch(`/api/payroll/contractors/${contractor.id}`, {
        name: contractor.name,
        clockifyUserId: contractor.clockifyUserId,
        payType,
        weeklyAmount: payType === "FLAT_WEEKLY" ? rate.trim() : undefined,
        hourlyRate: payType === "HOURLY" ? rate.trim() : undefined,
        invoicePrefix: prefix.trim().toUpperCase(),
        active,
        remittanceEmail: email.trim() || null,
        notes: contractor.notes,
      });
      toast.success(`${contractor.name} updated.`);
      onDone();
    } catch (error) {
      toast.error(
        "Could not save.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit ${contractor.name}`}
      description={
        contractor.invoiceCount > 0
          ? `${contractor.invoiceCount} invoice${contractor.invoiceCount === 1 ? "" : "s"} already issued. Changing a rate affects future weeks only.`
          : "No invoices issued yet."
      }
      width="sm"
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" loading={busy} disabled={rate.trim() === ""} onClick={submit}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Pay type">
          <select
            value={payType}
            onChange={(event) => setPayType(event.target.value as PayType)}
            className="w-full rounded-md border px-2 py-1.5 text-[12.5px]"
            style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
          >
            {PAY_TYPES.map((type) => (
              <option key={type} value={type}>
                {PAY_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>

        <Field label={payType === "HOURLY" ? "Hourly rate" : "Weekly amount"}>
          <input
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            className="w-full rounded-md border px-2 py-1.5 text-[12.5px] tabular-nums"
            style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
          />
        </Field>

        <Field label="Invoice prefix">
          <input
            value={prefix}
            onChange={(event) => setPrefix(event.target.value.toUpperCase())}
            className="w-full rounded-md border px-2 py-1.5 font-mono text-[12.5px]"
            style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
          />
        </Field>

        <Field label="Remittance email">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-md border px-2 py-1.5 text-[12.5px]"
            style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
          />
        </Field>

        <label className="flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          Active — included in weekly imports
        </label>
      </div>
    </Dialog>
  );
}
