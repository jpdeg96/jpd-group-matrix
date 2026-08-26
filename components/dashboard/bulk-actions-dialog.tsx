"use client";

import * as React from "react";
import { Badge, Button, Dialog, Input, Muted, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";

interface BulkChange {
  field: string;
  from: string | null;
  to: string | null;
  /** `ADD` is gained rather than replaced — an appended note. */
  kind?: "SET" | "ADD";
}

type BulkOutcome = "UPDATE" | "DELETE" | "CANCEL" | "SKIP" | "UNCHANGED";

interface BulkEventPlan {
  eventId: string;
  label: string;
  outcome: BulkOutcome;
  reason: string | null;
  changes: BulkChange[];
}

interface BulkPlan {
  events: BulkEventPlan[];
  counts: Record<"update" | "delete" | "cancel" | "skip" | "unchanged", number>;
  warnings: string[];
}

interface BulkResult {
  updated: number;
  deleted: number;
  cancelled: number;
  skipped: number;
  unchanged: number;
}

/** Which fields the person has opted into changing. */
interface Enabled {
  eventTypeId: boolean;
  awayTeam: boolean;
  homeTeam: boolean;
  venue: boolean;
  assigneeId: boolean;
  flag: boolean;
  note: boolean;
}

const NOTHING_ENABLED: Enabled = {
  eventTypeId: false,
  awayTeam: false,
  homeTeam: false,
  venue: false,
  assigneeId: false,
  flag: false,
  note: false,
};

/**
 * Bulk changes to the selected events.
 *
 * Two steps, and the second one is the point. Choosing what to change is a
 * form like any other; what makes a bulk edit safe is seeing the specific rows
 * it will land on before it lands. The review step is not a "are you sure?" —
 * it is the server's own plan, per event, including the rows that will be
 * skipped and why.
 *
 * Opting in per field, rather than "leave blank to skip", is deliberate. Blank
 * has to mean *something* on a text field, and here it means "clear this
 * column" — which is a legitimate thing to want and an appalling thing to do by
 * accident to forty rows. The checkbox separates the two.
 */
export function BulkActionsDialog({
  eventIds,
  types,
  users,
  onClose,
  onApplied,
}: {
  eventIds: string[];
  types: Array<{ id: string; name: string; emoji: string | null }>;
  users: Array<{ id: string; displayName: string; active: boolean }>;
  onClose: () => void;
  /** Fired after a successful apply, so the table can drop its selection and re-read. */
  onApplied: (result: BulkResult) => void;
}) {
  const toast = useToast();

  const [step, setStep] = React.useState<"CHOOSE" | "REVIEW">("CHOOSE");
  const [enabled, setEnabled] = React.useState<Enabled>(NOTHING_ENABLED);
  const [removing, setRemoving] = React.useState(false);

  const [eventTypeId, setEventTypeId] = React.useState("");
  const [awayTeam, setAwayTeam] = React.useState("");
  const [homeTeam, setHomeTeam] = React.useState("");
  const [venue, setVenue] = React.useState("");
  const [assigneeId, setAssigneeId] = React.useState("");
  const [flagAction, setFlagAction] = React.useState<"RAISE" | "CLEAR">("RAISE");
  const [flagReason, setFlagReason] = React.useState("");
  const [note, setNote] = React.useState("");

  const [plan, setPlan] = React.useState<BulkPlan | null>(null);
  const [pending, setPending] = React.useState(false);

  const activeUsers = React.useMemo(() => users.filter((user) => user.active), [users]);

  /** The request body, shared by the preview and the apply so they cannot diverge. */
  const body = React.useMemo(() => {
    if (removing) return { eventIds, remove: true };

    return {
      eventIds,
      ...(enabled.eventTypeId && eventTypeId ? { eventTypeId } : {}),
      ...(enabled.awayTeam ? { awayTeam } : {}),
      ...(enabled.homeTeam ? { homeTeam } : {}),
      ...(enabled.venue ? { venue } : {}),
      ...(enabled.assigneeId ? { assigneeId } : {}),
      ...(enabled.flag
        ? {
            flag:
              flagAction === "RAISE"
                ? { action: "RAISE" as const, reason: flagReason }
                : { action: "CLEAR" as const },
          }
        : {}),
      ...(enabled.note ? { note } : {}),
    };
  }, [
    eventIds, removing, enabled, eventTypeId, awayTeam, homeTeam, venue,
    assigneeId, flagAction, flagReason, note,
  ]);

  const chosenAnything =
    removing ||
    (Object.values(enabled).some(Boolean) &&
      // A type change with no type picked is not a change yet.
      (!enabled.eventTypeId || eventTypeId !== "") &&
      (!enabled.note || note.trim() !== ""));

  async function review() {
    setPending(true);
    try {
      const data = await api.post<{ plan: BulkPlan }>("/api/events/bulk/preview", body);
      setPlan(data.plan);
      setStep("REVIEW");
    } catch (error) {
      toast.error(
        "Could not work out what that would change.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  async function apply() {
    setPending(true);
    try {
      const data = await api.post<{ result: BulkResult }>("/api/events/bulk", body);
      onApplied(data.result);
    } catch (error) {
      toast.error(
        "Could not apply the changes.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
      setPending(false);
    }
  }

  const count = eventIds.length;
  const noun = `${count} ${count === 1 ? "event" : "events"}`;

  return (
    <Dialog
      open
      onClose={onClose}
      title={step === "CHOOSE" ? `Bulk change ${noun}` : "Review changes"}
      description={
        step === "CHOOSE"
          ? "Tick a field to change it. Anything left unticked is untouched."
          : "Exactly what will happen, event by event. Nothing has been changed yet."
      }
      width="lg"
      footer={
        step === "CHOOSE" ? (
          <>
            <Button onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={removing ? "danger" : "primary"}
              loading={pending}
              disabled={!chosenAnything}
              onClick={review}
            >
              Review changes
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setStep("CHOOSE")} disabled={pending}>
              Back
            </Button>
            <Button
              variant={removing ? "danger" : "primary"}
              loading={pending}
              disabled={
                plan === null ||
                plan.counts.update + plan.counts.delete + plan.counts.cancel === 0
              }
              onClick={apply}
            >
              {removing ? "Delete them" : "Apply changes"}
            </Button>
          </>
        )
      }
    >
      {step === "CHOOSE" ? (
        <ChooseStep
          removing={removing}
          setRemoving={setRemoving}
          enabled={enabled}
          setEnabled={setEnabled}
          types={types}
          activeUsers={activeUsers}
          values={{ eventTypeId, awayTeam, homeTeam, venue, assigneeId, flagAction, flagReason, note }}
          setters={{
            setEventTypeId, setAwayTeam, setHomeTeam, setVenue,
            setAssigneeId, setFlagAction, setFlagReason, setNote,
          }}
          count={count}
        />
      ) : (
        <ReviewStep plan={plan} removing={removing} />
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function ChooseStep({
  removing,
  setRemoving,
  enabled,
  setEnabled,
  types,
  activeUsers,
  values,
  setters,
  count,
}: {
  removing: boolean;
  setRemoving: (value: boolean) => void;
  enabled: Enabled;
  setEnabled: React.Dispatch<React.SetStateAction<Enabled>>;
  types: Array<{ id: string; name: string; emoji: string | null }>;
  activeUsers: Array<{ id: string; displayName: string }>;
  values: {
    eventTypeId: string; awayTeam: string; homeTeam: string; venue: string;
    assigneeId: string; flagAction: "RAISE" | "CLEAR"; flagReason: string; note: string;
  };
  setters: {
    setEventTypeId: (v: string) => void; setAwayTeam: (v: string) => void;
    setHomeTeam: (v: string) => void; setVenue: (v: string) => void;
    setAssigneeId: (v: string) => void; setFlagAction: (v: "RAISE" | "CLEAR") => void;
    setFlagReason: (v: string) => void; setNote: (v: string) => void;
  };
  count: number;
}) {
  const toggle = (key: keyof Enabled) =>
    setEnabled((current) => ({ ...current, [key]: !current[key] }));

  return (
    <div className="space-y-3">
      <fieldset disabled={removing} className={removing ? "opacity-40" : undefined}>
        <div className="space-y-2.5">
          <Field
            label="Type"
            checked={enabled.eventTypeId}
            onToggle={() => toggle("eventTypeId")}
          >
            <Select
              aria-label="New type"
              value={values.eventTypeId}
              onChange={(event) => setters.setEventTypeId(event.target.value)}
            >
              <option value="">Choose a type…</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.emoji ? `${type.emoji} ` : ""}
                  {type.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Away team / artist"
            checked={enabled.awayTeam}
            onToggle={() => toggle("awayTeam")}
            hint="Leave empty to clear it"
          >
            <Input
              aria-label="New away team or artist"
              value={values.awayTeam}
              onChange={(event) => setters.setAwayTeam(event.target.value)}
              placeholder="Empty clears the field"
            />
          </Field>

          <Field
            label="Home team"
            checked={enabled.homeTeam}
            onToggle={() => toggle("homeTeam")}
            hint="Leave empty to clear it"
          >
            <Input
              aria-label="New home team"
              value={values.homeTeam}
              onChange={(event) => setters.setHomeTeam(event.target.value)}
              placeholder="Empty clears the field"
            />
          </Field>

          <Field
            label="Venue"
            checked={enabled.venue}
            onToggle={() => toggle("venue")}
            hint="Leave empty to clear it"
          >
            <Input
              aria-label="New venue"
              value={values.venue}
              onChange={(event) => setters.setVenue(event.target.value)}
              placeholder="Empty clears the field"
            />
          </Field>

          <Field label="Assigned" checked={enabled.assigneeId} onToggle={() => toggle("assigneeId")}>
            <Select
              aria-label="New assignee"
              value={values.assigneeId}
              onChange={(event) => setters.setAssigneeId(event.target.value)}
            >
              <option value="">Unassigned</option>
              {activeUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Flag" checked={enabled.flag} onToggle={() => toggle("flag")}>
            <div className="space-y-1.5">
              <Select
                aria-label="Flag action"
                value={values.flagAction}
                onChange={(event) =>
                  setters.setFlagAction(event.target.value as "RAISE" | "CLEAR")
                }
              >
                <option value="RAISE">Raise a flag</option>
                <option value="CLEAR">Clear the flag</option>
              </Select>
              {values.flagAction === "RAISE" ? (
                <Input
                  aria-label="Flag reason"
                  value={values.flagReason}
                  onChange={(event) => setters.setFlagReason(event.target.value)}
                  placeholder="What needs looking at? (optional)"
                />
              ) : null}
            </div>
          </Field>

          <Field
            label="Note"
            checked={enabled.note}
            onToggle={() => toggle("note")}
            hint="Added to every selected event"
          >
            <Textarea
              aria-label="Note to add"
              rows={2}
              value={values.note}
              onChange={(event) => setters.setNote(event.target.value)}
              placeholder="Added as a new note on each event…"
            />
          </Field>
        </div>
      </fieldset>

      {/* Kept apart from the fields above, and mutually exclusive with them.
          Deleting and editing in one action has no useful reading: either the
          edit is pointless or the delete is a mistake. */}
      <div
        className="rounded-md border p-2.5"
        style={{
          borderColor: removing ? "var(--danger)" : "var(--line)",
          background: removing ? "var(--danger-soft)" : "transparent",
        }}
      >
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={removing}
            onChange={(event) => setRemoving(event.target.checked)}
          />
          <span>
            <span className="block text-[12.5px] font-semibold" style={{ color: "var(--danger)" }}>
              Delete these {count === 1 ? "event" : "events"} instead
            </span>
            <span className="block text-[11px]" style={{ color: "var(--ink-subtle)" }}>
              Cannot be combined with the changes above. Anything with completed
              review work is cancelled rather than deleted, so the record is
              kept — the review step says which.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}

/** One opt-in row: the checkbox decides whether the control is even consulted. */
function Field({
  label,
  hint,
  checked,
  onToggle,
  children,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[auto_9rem_1fr] items-start gap-2">
      <input
        type="checkbox"
        className="mt-1.5"
        checked={checked}
        onChange={onToggle}
        aria-label={`Change ${label}`}
      />
      <label className="mt-1 cursor-pointer" onClick={onToggle}>
        <span className="block text-[12.5px] font-medium">{label}</span>
        {hint ? (
          <span className="block text-[10.5px]" style={{ color: "var(--ink-subtle)" }}>
            {hint}
          </span>
        ) : null}
      </label>
      <div className={checked ? undefined : "pointer-events-none opacity-40"}>{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ReviewStep({ plan, removing }: { plan: BulkPlan | null; removing: boolean }) {
  if (!plan) {
    return (
      <p className="text-[12px]" style={{ color: "var(--ink-subtle)" }}>
        Working it out…
      </p>
    );
  }

  const acting = plan.counts.update + plan.counts.delete + plan.counts.cancel;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {plan.counts.update > 0 ? (
          <Badge tone="success">{plan.counts.update} to change</Badge>
        ) : null}
        {plan.counts.delete > 0 ? (
          <Badge tone="danger">{plan.counts.delete} to delete</Badge>
        ) : null}
        {plan.counts.cancel > 0 ? (
          <Badge tone="warn">{plan.counts.cancel} to cancel</Badge>
        ) : null}
        {plan.counts.unchanged > 0 ? (
          <Badge>{plan.counts.unchanged} already correct</Badge>
        ) : null}
        {plan.counts.skip > 0 ? <Badge>{plan.counts.skip} skipped</Badge> : null}
      </div>

      {plan.warnings.map((warning) => (
        <p
          key={warning}
          className="rounded-md border px-2.5 py-1.5 text-[11.5px]"
          style={{ borderColor: "var(--warn)", background: "var(--warn-soft)", color: "var(--warn)" }}
        >
          {warning}
        </p>
      ))}

      {acting === 0 ? (
        <p className="text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
          Nothing would change. Go back and pick something else.
        </p>
      ) : null}

      <div
        className="max-h-[45vh] space-y-1.5 overflow-y-auto scrollbar-thin border-t pt-3"
        style={{ borderColor: "var(--line)" }}
      >
        {plan.events.map((event) => (
          <article
            key={event.eventId}
            className="rounded-md border px-2.5 py-2"
            style={{
              borderColor: "var(--line)",
              background: "var(--canvas)",
              // Rows that will not be acted on are dimmed rather than hidden:
              // seeing that a selected event is being left alone is the whole
              // reason for reading this screen.
              opacity: event.outcome === "SKIP" || event.outcome === "UNCHANGED" ? 0.6 : 1,
            }}
          >
            <header className="flex items-start justify-between gap-2">
              <span className="text-[12.5px] font-medium">{event.label}</span>
              <OutcomeBadge outcome={event.outcome} removing={removing} />
            </header>

            {event.reason ? (
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-subtle)" }}>
                {event.reason}
              </p>
            ) : null}

            {event.changes.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {event.changes.map((change) => (
                  <li key={change.field} className="text-[11.5px]">
                    <span style={{ color: "var(--ink-subtle)" }}>{change.field}: </span>
                    {change.kind === "ADD" ? (
                      // Gained, not replaced. Nothing is struck through because
                      // nothing is being lost.
                      <span className="font-medium">
                        adding “{change.to}”
                      </span>
                    ) : (
                      <>
                        <span className="line-through" style={{ color: "var(--ink-subtle)" }}>
                          {change.from ?? "empty"}
                        </span>
                        <span style={{ color: "var(--ink-subtle)" }}> → </span>
                        <span className="font-medium">{change.to ?? "empty"}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function OutcomeBadge({ outcome, removing }: { outcome: BulkOutcome; removing: boolean }) {
  switch (outcome) {
    case "DELETE":
      return <Badge tone="danger">Delete</Badge>;
    case "CANCEL":
      return <Badge tone="warn">Cancel instead</Badge>;
    case "UPDATE":
      return <Badge tone="success">{removing ? "Delete" : "Change"}</Badge>;
    case "UNCHANGED":
      return <Badge>No change</Badge>;
    default:
      return <Badge>Skipped</Badge>;
  }
}

/* -------------------------------------------------------------------------- */

/**
 * The floating "Select Action(s)" button.
 *
 * Bottom right and fixed, because the selection is made by scrolling a long
 * table and a control at the top of the page would be off screen exactly when
 * it is wanted. It appears only once something is selected — an always-present
 * button that does nothing is worse than no button.
 */
export function BulkSelectionBar({
  count,
  onOpen,
  onClear,
}: {
  count: number;
  onOpen: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-lg border px-3 py-2 shadow-xl"
         style={{ background: "var(--surface-raised)", borderColor: "var(--line-strong)" }}>
      <span className="text-[12.5px] font-medium tabular-nums">
        {count} selected
      </span>
      <Button size="sm" onClick={onClear}>
        Clear
      </Button>
      <Button size="sm" variant="primary" onClick={onOpen}>
        Select Action(s)
      </Button>
    </div>
  );
}

export type { BulkResult };
