"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import {
  normaliseReviewOffsets,
  reviewStageLabel,
  THEME_LABELS,
  THEMES,
  type ThemeValue,
} from "@/lib/domain/constants";
import type { AppSettings } from "@/lib/services/settings";
import type { EventTypeView } from "@/lib/services/event-types";
import { PayrollSettings } from "./payroll-settings";
import { IntegrationSettings } from "./integration-settings";

/** Common zones offered as shortcuts; any IANA name may still be typed. */
const TIMEZONE_SUGGESTIONS = [
  "America/Caracas",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Bogota",
  "America/Mexico_City",
  "UTC",
  "Europe/London",
  "Europe/Madrid",
];

export function SettingsView({
  settings,
  types,
  clockifyKeyPresent,
  emailConfigured,
  emailFrom,
  driveKeyPresent,
  discordWebhookPresent,
}: {
  settings: AppSettings;
  types: EventTypeView[];
  clockifyKeyPresent: boolean;
  emailConfigured: boolean;
  emailFrom: string | null;
  driveKeyPresent: boolean;
  discordWebhookPresent: boolean;
}) {
  return (
    <div className="space-y-4">
      <GeneralSettings settings={settings} />
      <ReviewStageSettings settings={settings} />
      <EventTypeSettings types={types} />
      <ClockifySettings settings={settings} keyPresent={clockifyKeyPresent} />
      <PayrollSettings
        settings={settings}
        emailConfigured={emailConfigured}
        emailFrom={emailFrom}
      />
      <IntegrationSettings
        settings={settings}
        driveKeyPresent={driveKeyPresent}
        discordWebhookPresent={discordWebhookPresent}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Clockify                                                                   */
/* -------------------------------------------------------------------------- */

function ClockifySettings({
  settings,
  keyPresent,
}: {
  settings: AppSettings;
  keyPresent: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [enabled, setEnabled] = React.useState(settings.clockifyEnabled);
  const [workspaceId, setWorkspaceId] = React.useState(
    settings.clockifyWorkspaceId ?? "",
  );
  const [pending, setPending] = React.useState(false);

  async function save() {
    setPending(true);
    try {
      await api.patch("/api/settings", {
        clockifyEnabled: enabled,
        clockifyWorkspaceId: workspaceId.trim() || null,
      });
      toast.success("Clockify settings saved.");
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not save Clockify settings.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <PageHeader
        title="Clockify"
        subtitle="Shows each person their time today and this week, and who is currently clocked in."
        actions={
          <Button variant="primary" size="sm" loading={pending} onClick={save}>
            Save
          </Button>
        }
      />

      <div className="space-y-4 p-5">
        <div
          className="rounded-md border px-3 py-2 text-[11.5px]"
          style={{
            borderColor: keyPresent ? "var(--success)" : "var(--warn)",
            background: keyPresent ? "var(--success-soft)" : "var(--warn-soft)",
            color: keyPresent ? "var(--success)" : "var(--warn)",
          }}
        >
          <Badge tone={keyPresent ? "success" : "warn"}>
            {keyPresent ? "API key detected" : "API key missing"}
          </Badge>{" "}
          {keyPresent ? (
            <>
              CLOCKIFY_API_KEY is set on the server.
              <span className="mt-1 block opacity-80">
                If you rotate the key, <strong>restart the server</strong> —{" "}
                <code>.env</code> is read once at startup, so a running process
                keeps using the old one and Clockify will reject it.
              </span>
            </>
          ) : (
            <>
              The workspace ID below is <strong>not</strong> the API key — they
              are two separate values, and the key is missing.
              <span className="mt-1.5 block">
                Get it from Clockify → <strong>Profile settings → API</strong>,
                then add this line to <code>.env</code> and restart the server:
              </span>
              <code
                className="mt-1 block rounded px-2 py-1 font-mono text-[11px]"
                style={{ background: "var(--surface)", color: "var(--ink)" }}
              >
                CLOCKIFY_API_KEY=&quot;your-key-here&quot;
              </code>
              <span className="mt-1.5 block">
                It lives in the environment rather than in this form so a
                database dump never contains a live credential.
              </span>
            </>
          )}
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-[12.5px]">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            style={{ accentColor: "var(--accent)" }}
            className="mt-0.5 h-3.5 w-3.5"
          />
          <span>
            Enable the Clockify time widget
            <span className="block text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              When off, nothing Clockify-related is shown or requested.
            </span>
          </span>
        </label>

        <Field
          label="Workspace ID"
          htmlFor="clockifyWorkspaceId"
          hint="Clockify → Workspace settings. It is the long id in the URL, e.g. 5f2a…"
        >
          <Input
            id="clockifyWorkspaceId"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
            placeholder="5f2abc1234def5678901234a"
          />
        </Field>

        <p className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
          Each person also needs their Clockify user linked, under Users. Anyone
          not linked simply sees no time figures.
        </p>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* General                                                                    */
/* -------------------------------------------------------------------------- */

function GeneralSettings({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const toast = useToast();

  const [siteName, setSiteName] = React.useState(settings.siteName);
  const [timeZone, setTimeZone] = React.useState(settings.timeZone);
  const [defaultTheme, setDefaultTheme] = React.useState<ThemeValue>(
    settings.defaultTheme,
  );
  const [presenceTimeout, setPresenceTimeout] = React.useState(
    settings.presenceTimeoutMinutes,
  );
  const [seatGeek, setSeatGeek] = React.useState(settings.seatGeekLinksEnabled);
  const [stubHub, setStubHub] = React.useState(settings.stubHubLinksEnabled);
  const [pending, setPending] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});

  const zonePreview = React.useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date());
    } catch {
      return null;
    }
  }, [timeZone]);

  async function save() {
    setPending(true);
    setErrors({});
    try {
      await api.patch("/api/settings", {
        siteName,
        timeZone,
        defaultTheme,
        presenceTimeoutMinutes: presenceTimeout,
        seatGeekLinksEnabled: seatGeek,
        stubHubLinksEnabled: stubHub,
      });
      toast.success("Settings saved.");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrors(error.fieldErrors ?? {});
        if (!error.fieldErrors) toast.error("Could not save settings.", error.message);
      } else {
        toast.error("Could not save settings.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <PageHeader
        title="General"
        subtitle="Site identity, business timezone and defaults."
        actions={
          <Button variant="primary" size="sm" loading={pending} onClick={save}>
            Save
          </Button>
        }
      />

      <div className="grid gap-4 p-5 md:grid-cols-2">
        <Field label="Site name" htmlFor="siteName" errors={errors.siteName}>
          <Input
            id="siteName"
            value={siteName}
            onChange={(event) => setSiteName(event.target.value)}
          />
        </Field>

        <Field
          label="Business timezone"
          htmlFor="timeZone"
          errors={errors.timeZone}
          hint={
            zonePreview
              ? `Right now that is ${zonePreview}. Every date and deadline in the app is calculated in this zone.`
              : "Not a recognised IANA timezone."
          }
        >
          <Input
            id="timeZone"
            list="timezone-options"
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
          />
          <datalist id="timezone-options">
            {TIMEZONE_SUGGESTIONS.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </Field>

        <Field
          label="Default theme"
          htmlFor="defaultTheme"
          hint="Applies to people who have not picked their own."
        >
          <Select
            id="defaultTheme"
            value={defaultTheme}
            onChange={(event) => setDefaultTheme(event.target.value as ThemeValue)}
          >
            {THEMES.map((theme) => (
              <option key={theme} value={theme}>
                {THEME_LABELS[theme]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="In-progress timeout (minutes)"
          htmlFor="presenceTimeout"
          errors={errors.presenceTimeoutMinutes}
          hint="How long an 'in progress' flag survives without a heartbeat. Short enough that a closed laptop clears itself."
        >
          <Input
            id="presenceTimeout"
            type="number"
            min={1}
            max={120}
            value={presenceTimeout}
            onChange={(event) => setPresenceTimeout(Number(event.target.value))}
          />
        </Field>

        <div className="md:col-span-2">
          <p className="mb-2 text-[12px] font-medium" style={{ color: "var(--ink-muted)" }}>
            Marketplace links
          </p>
          <div className="flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
              <input
                type="checkbox"
                checked={seatGeek}
                onChange={(event) => setSeatGeek(event.target.checked)}
                style={{ accentColor: "var(--accent)" }}
                className="h-3.5 w-3.5"
              />
              Show SeatGeek search links
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px]">
              <input
                type="checkbox"
                checked={stubHub}
                onChange={(event) => setStubHub(event.target.checked)}
                style={{ accentColor: "var(--accent)" }}
                className="h-3.5 w-3.5"
              />
              Show StubHub search links
            </label>
          </div>
          <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
            These are search links built from the event&apos;s own teams and venue —
            no API key and nothing to expire. They land on a results page rather
            than the exact event.
          </p>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Review stages                                                              */
/* -------------------------------------------------------------------------- */

function ReviewStageSettings({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const toast = useToast();

  const [offsets, setOffsets] = React.useState<number[]>(settings.reviewOffsets);
  const [draft, setDraft] = React.useState("");
  const [weekend, setWeekend] = React.useState(settings.weekendAdjustment);
  const [pending, setPending] = React.useState(false);

  function addOffset() {
    const value = Number(draft);
    if (!Number.isFinite(value) || value <= 0) return;
    setOffsets((current) => normaliseReviewOffsets([...current, value]));
    setDraft("");
  }

  async function save() {
    if (offsets.length === 0) {
      toast.error("Add at least one review stage.");
      return;
    }

    setPending(true);
    try {
      await api.patch("/api/settings", {
        reviewOffsets: offsets,
        weekendAdjustment: weekend,
      });
      toast.success("Review stages saved.");
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not save review stages.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <PageHeader
        title="Review stages"
        subtitle="How many checkpoints each event gets in C1, and how far before the event each one falls."
        actions={
          <Button variant="primary" size="sm" loading={pending} onClick={save}>
            Save
          </Button>
        }
      />

      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          {offsets.map((offset) => (
            <span
              key={offset}
              className="inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[12px] font-semibold"
              style={{ borderColor: "var(--line-strong)", background: "var(--canvas)" }}
            >
              {reviewStageLabel(offset)}
              <button
                type="button"
                aria-label={`Remove ${reviewStageLabel(offset)}`}
                onClick={() =>
                  setOffsets((current) => current.filter((item) => item !== offset))
                }
                className="opacity-60 transition hover:opacity-100"
                style={{ color: "var(--danger)" }}
              >
                ×
              </button>
            </span>
          ))}
          {offsets.length === 0 ? (
            <span className="text-[12px]" style={{ color: "var(--danger)" }}>
              At least one stage is required.
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Add a stage (days before the event)" htmlFor="offset" className="w-56">
            <Input
              id="offset"
              type="number"
              min={1}
              max={365}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addOffset();
                }
              }}
              placeholder="e.g. 3"
            />
          </Field>
          <Button size="sm" onClick={addOffset} disabled={!draft}>
            Add stage
          </Button>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-[12.5px]">
          <input
            type="checkbox"
            checked={weekend}
            onChange={(event) => setWeekend(event.target.checked)}
            style={{ accentColor: "var(--accent)" }}
            className="mt-0.5 h-3.5 w-3.5"
          />
          <span>
            Move weekend deadlines back to the preceding Friday
            <span className="block text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              Saturday and Sunday only. Public holidays are not considered. Two
              stages can end up sharing a due date as a result, which is expected.
            </span>
          </span>
        </label>

        <div
          className="rounded-md border px-3 py-2 text-[11.5px]"
          style={{ borderColor: "var(--warn)", background: "var(--warn-soft)", color: "var(--warn)" }}
        >
          <Badge tone="warn">Not retroactive</Badge>{" "}
          Changing these stages affects events promoted from now on. Events
          already in C1 keep the stages, assignments and completions they have —
          rewriting them would invalidate work people already signed off.
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Event types                                                                */
/* -------------------------------------------------------------------------- */

function EventTypeSettings({ types }: { types: EventTypeView[] }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = React.useState("");
  const [emoji, setEmoji] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;

    setPending(true);
    try {
      // Omitting emoji lets the server suggest one from the name; sending an
      // explicit value always wins.
      await api.post("/api/event-types", {
        name: trimmed,
        ...(emoji.trim() ? { emoji: emoji.trim() } : {}),
      });
      setName("");
      setEmoji("");
      toast.success(`Added "${trimmed}".`);
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not add type.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  async function setTypeEmoji(type: EventTypeView, value: string) {
    setPending(true);
    try {
      await api.patch(`/api/event-types/${type.id}`, { emoji: value.trim() || null });
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not update the emoji.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  async function toggleActive(type: EventTypeView) {
    setPending(true);
    try {
      await api.patch(`/api/event-types/${type.id}`, { active: !type.active });
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not update type.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  async function remove(type: EventTypeView) {
    if (!window.confirm(`Delete the type "${type.name}"?`)) return;

    setPending(true);
    try {
      await api.delete(`/api/event-types/${type.id}`);
      toast.success(`Deleted "${type.name}".`);
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not delete type.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <PageHeader
        title="Event types"
        subtitle="The Type column on the dashboard. A type still attached to events can be deactivated but not deleted."
      />

      <div className="flex flex-wrap items-end gap-2 border-b px-5 py-3" style={{ borderColor: "var(--line)" }}>
        <Field label="New type" htmlFor="typeName" className="w-64">
          <Input
            id="typeName"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void create();
              }
            }}
            placeholder="e.g. NHL, Concert, Theatre"
          />
        </Field>
        <Field
          label="Emoji"
          htmlFor="typeEmoji"
          className="w-28"
          hint="Optional — guessed from the name."
        >
          <Input
            id="typeEmoji"
            value={emoji}
            onChange={(event) => setEmoji(event.target.value)}
            placeholder="🏀"
            maxLength={8}
            className="text-center text-[16px]"
          />
        </Field>
        <Button size="sm" variant="primary" loading={pending} disabled={!name.trim()} onClick={create}>
          Add type
        </Button>
      </div>

      <table className="w-full border-collapse">
        <thead style={{ background: "var(--canvas)" }}>
          <tr>
            <th className="px-5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-subtle)" }}>
              Emoji
            </th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-subtle)" }}>
              Name
            </th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-subtle)" }}>
              Status
            </th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-subtle)" }}>
              Events
            </th>
            <th className="px-5 py-2 text-right text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-subtle)" }}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {types.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-5 py-6 text-center text-[12px]" style={{ color: "var(--ink-subtle)" }}>
                No types yet. Add one above before creating events.
              </td>
            </tr>
          ) : (
            types.map((type) => (
              <tr key={type.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                <td className="px-5 py-2">
                  <Input
                    aria-label={`Emoji for ${type.name}`}
                    defaultValue={type.emoji ?? ""}
                    maxLength={8}
                    disabled={pending}
                    onBlur={(event) => {
                      if ((event.target.value.trim() || null) !== type.emoji) {
                        void setTypeEmoji(type, event.target.value);
                      }
                    }}
                    className="h-7 w-14 px-1 text-center text-[16px]"
                  />
                </td>
                <td className="px-3 py-2 text-[12.5px] font-medium">{type.name}</td>
                <td className="px-3 py-2">
                  <Badge tone={type.active ? "success" : "neutral"}>
                    {type.active ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-[12.5px] tabular-nums">{type.eventCount}</td>
                <td className="px-5 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggleActive(type)}>
                      {type.active ? "Deactivate" : "Reactivate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending || type.eventCount > 0}
                      title={
                        type.eventCount > 0
                          ? "In use by existing events — deactivate instead."
                          : undefined
                      }
                      onClick={() => remove(type)}
                      style={{ color: "var(--danger)" }}
                    >
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}
