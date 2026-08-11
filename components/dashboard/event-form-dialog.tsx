"use client";

import * as React from "react";
import { Button, Dialog, Field, Input, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { isPlainDate } from "@/lib/date/plain-date";
import { UNASSIGNED_LABEL } from "@/lib/domain/constants";
import type { DashboardEventView } from "@/lib/services/events";
import type { UserOption } from "@/lib/services/users";

interface FormState {
  eventDate: string;
  eventTypeId: string;
  awayTeam: string;
  homeTeam: string;
  venue: string;
  assigneeId: string;
}

const EMPTY: FormState = {
  eventDate: "",
  eventTypeId: "",
  awayTeam: "",
  homeTeam: "",
  venue: "",
  assigneeId: "",
};

export function EventFormDialog({
  open,
  event,
  types,
  users,
  canAssign,
  onClose,
  onSaved,
}: {
  open: boolean;
  event: DashboardEventView | null;
  types: Array<{ id: string; name: string }>;
  users: UserOption[];
  canAssign: boolean;
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
      event
        ? {
            eventDate: event.eventDate,
            eventTypeId: event.eventTypeId,
            awayTeam: event.awayTeam ?? "",
            homeTeam: event.homeTeam ?? "",
            venue: event.venue ?? "",
            assigneeId: event.assigneeId ?? "",
          }
        : { ...EMPTY, eventTypeId: types[0]?.id ?? "" },
    );
  }, [open, event, types]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function onSubmit(submitEvent: React.FormEvent) {
    submitEvent.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // Immediate feedback only — the server validates this again and is the
    // authority. An invalid date is never silently interpreted as today.
    if (!isPlainDate(form.eventDate)) {
      setFieldErrors({ eventDate: ["Enter a valid calendar date."] });
      return;
    }
    if (!form.eventTypeId) {
      setFieldErrors({ eventTypeId: ["Choose a type."] });
      return;
    }

    const payload = {
      eventDate: form.eventDate,
      eventTypeId: form.eventTypeId,
      awayTeam: form.awayTeam.trim(),
      homeTeam: form.homeTeam.trim(),
      venue: form.venue.trim(),
      ...(canAssign ? { assigneeId: form.assigneeId || null } : {}),
    };

    setPending(true);
    try {
      if (event !== null) {
        await api.patch(`/api/events/${event.id}`, payload);
        toast.success("Event updated.");
      } else {
        await api.post("/api/events", payload);
        toast.success("Event added.");
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
      title={event ? "Edit event" : "Add event"}
      description={
        event
          ? "Only the fields you change are written."
          : "Ticking Complete on the dashboard later is what sends it to C1."
      }
      width="lg"
      footer={
        <>
          <Button type="button" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="event-form" variant="primary" loading={pending}>
            {event ? "Save changes" : "Add event"}
          </Button>
        </>
      }
    >
      <form id="event-form" onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" htmlFor="eventDate" required errors={fieldErrors.eventDate}>
            <Input
              id="eventDate"
              type="date"
              required
              value={form.eventDate}
              onChange={(e) => update("eventDate", e.target.value)}
            />
          </Field>

          <Field
            label="Type"
            htmlFor="eventTypeId"
            required
            errors={fieldErrors.eventTypeId}
            hint="Managed in Settings."
          >
            <Select
              id="eventTypeId"
              required
              value={form.eventTypeId}
              onChange={(e) => update("eventTypeId", e.target.value)}
            >
              <option value="">Choose a type…</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Away Team / Artist"
            htmlFor="awayTeam"
            errors={fieldErrors.awayTeam}
            hint="Optional — a single performer goes here."
          >
            <Input
              id="awayTeam"
              value={form.awayTeam}
              onChange={(e) => update("awayTeam", e.target.value)}
            />
          </Field>

          <Field label="Home Team" htmlFor="homeTeam" errors={fieldErrors.homeTeam}>
            <Input
              id="homeTeam"
              value={form.homeTeam}
              onChange={(e) => update("homeTeam", e.target.value)}
            />
          </Field>
        </div>

        <Field label="Venue" htmlFor="venue" errors={fieldErrors.venue}>
          <Input
            id="venue"
            value={form.venue}
            onChange={(e) => update("venue", e.target.value)}
          />
        </Field>

        {canAssign ? (
          <Field
            label="Assigned"
            htmlFor="assigneeId"
            errors={fieldErrors.assigneeId}
            hint="Only managers and administrators can assign work to other people."
          >
            <Select
              id="assigneeId"
              value={form.assigneeId}
              onChange={(e) => update("assigneeId", e.target.value)}
            >
              <option value="">{UNASSIGNED_LABEL}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

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
