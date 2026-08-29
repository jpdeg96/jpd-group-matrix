"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CellSelect,
  Checkbox,
  EmptyState,
  Input,
  Muted,
  PageHeader,
  Select,
  StatPill,
  Td,
  Th,
  UserChip,
  LegacyBadge,
} from "@/components/ui/primitives";
import { Stamp } from "@/components/ui/stamp";
import { ResizeHandle, useColumnWidths } from "@/components/ui/use-column-widths";
import { useToast } from "@/components/ui/toast";
import { NotesCell, type NoteView } from "@/components/notes/notes-cell";
import { InProgressButton } from "@/components/presence/in-progress-button";
import { usePresence } from "@/components/presence/use-presence";
import { useLiveRefresh } from "@/components/presence/use-live-refresh";
import { rowElementId, useFocusedRow } from "@/components/presence/use-focused-row";
import { useCompletionCelebration } from "./use-completion-celebration";
import {
  PAGE_SIZES,
  pageSizeLabel,
  useTablePreferences,
} from "./use-table-preferences";
import { Celebration } from "@/components/ui/celebration";
import { useTheme } from "@/components/ui/theme";
import { FlagControl } from "@/components/flags/flag-control";
import { CompletionHistory } from "./completion-history";
import { EventFormDialog } from "./event-form-dialog";
import { ImportDialog } from "./import-dialog";
import {
  BulkActionsDialog,
  BulkSelectionBar,
  type BulkResult,
} from "./bulk-actions-dialog";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { cn } from "@/lib/ui/cn";
import { downloadCsv, toCsv } from "@/lib/ui/csv";
import { comparePlainDates, formatPlainDateWithWeekday, type PlainDate } from "@/lib/date/plain-date";
import { formatBusinessTimestamp } from "@/lib/date/business-time";
import {
  calendarDaysSince,
  daysUntilEvent,
  isStaleCompletion,
  isStaleDashboardEvent,
} from "@/lib/domain/review-schedule";
import { UNASSIGNED_FILTER, UNASSIGNED_LABEL } from "@/lib/domain/constants";
import type { DashboardEventView } from "@/lib/services/events";
import type { UserOption } from "@/lib/services/users";

type Field =
  | "assigneeId"
  | "complete"
  | "seatGeekChecked"
  | "ticketDataChecked"
  | "audited";

type SortKey =
  | "eventDate"
  | "eventTypeName"
  | "awayTeam"
  | "homeTeam"
  | "venue"
  | "assigneeName";

/** Which extra rows to include beyond the default open-work view. */
type Scope = "OPEN" | "COMPLETED" | "STALE" | "ALL" | "AWAITING_C1";

/**
 * One outstanding checkbox, when the header counter for it has been clicked.
 *
 * These mirror the counters exactly — same predicate, same OPEN scope — so the
 * number in the header and the number of rows on screen always agree. A filter
 * that shows a different count from the pill you pressed to get there reads as
 * a bug even when both are individually correct.
 */
type PendingWork = "SEATGEEK" | "TICKETDATA" | "AUDIT";

export function DashboardView({
  events: initialEvents,
  latestNotes: initialNotes,
  users,
  types,
  today,
  stats,
  currentUser,
  canManage,
  isAdmin,
  drilledFrom,
  importSheetUrl,
}: {
  events: DashboardEventView[];
  latestNotes: Record<string, NoteView>;
  users: UserOption[];
  types: Array<{ id: string; name: string; emoji: string | null }>;
  today: PlainDate;
  stats: {
    total: number;
    unassigned: number;
    seatGeekPending: number;
    ticketDataPending: number;
    auditPending: number;
    mine: number;
    archived: number;
    flagged: number;
    completed: number;
    staleCompleted: number;
    staleDays: number;
  };
  currentUser: { id: string; role: string };
  canManage: boolean;
  isAdmin: boolean;
  /** The linked Google Sheet Bulk import can read, or null. */
  importSheetUrl: string | null;
  /** Set when arriving from a Metrics bar, so the screen can say so. */
  drilledFrom: {
    personName: string;
    from: PlainDate | null;
    to: PlainDate | null;
  } | null;
}) {
  const router = useRouter();
  const toast = useToast();

  const [events, setEvents] = React.useState(initialEvents);
  const [notes, setNotes] = React.useState(initialNotes);
  const [noteCounts, setNoteCounts] = React.useState<Record<string, number>>({});
  const [pending, setPending] = React.useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("");
  const [assigneeFilter, setAssigneeFilter] = React.useState("");
  const [mineOnly, setMineOnly] = React.useState(false);
  const [flaggedOnly, setFlaggedOnly] = React.useState(false);
  const [scope, setScope] = React.useState<Scope>(drilledFrom ? "ALL" : "OPEN");
  const [pendingWork, setPendingWork] = React.useState<PendingWork | null>(null);
  const [sort, setSort] = React.useState<SortKey>("eventDate");
  const [direction, setDirection] = React.useState<"asc" | "desc">("asc");
  const [editing, setEditing] = React.useState<DashboardEventView | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  // Selection mode is off by default and the checkbox column only exists while
  // it is on. A permanently present checkbox on every row is a permanently
  // present way to tick the wrong one, on a screen whose actual job is ticking
  // boxes that mean something else entirely.
  const [selecting, setSelecting] = React.useState(false);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [bulkOpen, setBulkOpen] = React.useState(false);

  const columns = useColumnWidths("dashboard");
  const { pageSize, stripeRows, update: setPreference } = useTablePreferences("dashboard");
  const [page, setPage] = React.useState(0);

  React.useEffect(() => {
    setEvents(initialEvents);
    setNoteCounts({});
  }, [initialEvents]);

  React.useEffect(() => {
    setNotes(initialNotes);
  }, [initialNotes]);

  const presence = usePresence("DASHBOARD", currentUser.id);

  // Arrived from a "who is working on what" link. Every filter has to come off
  // first: the row being pointed at is frequently one this screen would hide —
  // it defaults to open work, and somebody is just as likely to be mid-review
  // on something already promoted.
  const focusId = useFocusedRow();
  React.useEffect(() => {
    if (!focusId) return;
    setScope("ALL");
    setSearch("");
    setTypeFilter("");
    setAssigneeFilter("");
    setMineOnly(false);
    setFlaggedOnly(false);
    setPendingWork(null);
  }, [focusId]);

  // Somebody else ticked a box, promoted an event or deleted one — re-read.
  useLiveRefresh(presence.revision, pending.size > 0);

  const { theme } = useTheme();
  const celebration = useCompletionCelebration(currentUser.id, today);

  const activeUsers = React.useMemo(
    () => users.filter((user) => user.active),
    [users],
  );

  // Audited and Actions are management concerns. Hiding the columns keeps the
  // grid narrower for the people who cannot act on them anyway; the server
  // enforces the same restriction independently.
  const showAudited = canManage;
  const showActions = canManage;

  const visible = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    const now = new Date();

    const filtered = events.filter((event) => {
      /*
       * Open and Completed follow the Complete tick, not the status.
       *
       * Unticking Complete deliberately leaves the event in C1, so a
       * status-based split kept it filed under Completed when the person who
       * unticked it had just said otherwise — and there was no way to get it
       * back onto the board. An event can be outstanding here while its review
       * continues in C1; the Dashboard tracks the preparation and C1 tracks the
       * review of it.
       *
       * ALL applies no filter at all — the one scope showing both together.
       */
      const finished = event.completedAt !== null;
      if (scope === "OPEN" && finished) return false;
      if (scope === "COMPLETED" && !finished) return false;
      if (scope === "STALE" && !isStaleCompletion(event.completedOn, today, stats.staleDays)) {
        return false;
      }
      // Complete, but nobody has sent it for review yet.
      if (scope === "AWAITING_C1" && !(event.completedAt && event.status === "DASHBOARD")) {
        return false;
      }

      if (typeFilter && event.eventTypeId !== typeFilter) return false;
      if (flaggedOnly && !event.flaggedAt) return false;
      if (pendingWork === "SEATGEEK" && event.seatGeekCheckedAt !== null) return false;
      if (pendingWork === "TICKETDATA" && event.ticketDataChecked) return false;
      if (pendingWork === "AUDIT" && event.auditedAt !== null) return false;
      if (assigneeFilter) {
        const matches =
          assigneeFilter === UNASSIGNED_FILTER
            ? event.assigneeId === null
            : event.assigneeId === assigneeFilter;
        if (!matches) return false;
      }
      if (mineOnly && event.assigneeId !== currentUser.id) return false;
      if (!needle) return true;
      return [event.eventTypeName, event.awayTeam, event.homeTeam, event.venue].some(
        (value) => value?.toLowerCase().includes(needle),
      );
    });

    const factor = direction === "asc" ? 1 : -1;

    // Every comparison falls through to the id. A comparator that returns 0
    // leans on the incoming order being stable, and it is not: the rows are
    // refetched whenever anybody ticks anything, and 563 of these events share
    // an event date *and* a creation timestamp from the spreadsheet import. Two
    // of them tying meant they could swap on any refresh, which is a row moving
    // a line under the cursor.
    return [...filtered].sort((a, b) => {
      if (sort === "eventDate") {
        return (
          factor * comparePlainDates(a.eventDate, b.eventDate) || a.id.localeCompare(b.id)
        );
      }
      const left = (a[sort] ?? "").toLowerCase();
      const right = (b[sort] ?? "").toLowerCase();
      if (left === right) {
        return comparePlainDates(a.eventDate, b.eventDate) || a.id.localeCompare(b.id);
      }
      return factor * (left < right ? -1 : 1);
    });
  }, [
    events, search, typeFilter, assigneeFilter, mineOnly, flaggedOnly, scope,
    pendingWork, sort, direction, currentUser.id, stats.staleDays,
  ]);

  const isPending = (id: string, field: Field) => pending.has(`${id}:${field}`);

  function toggleSort(key: SortKey) {
    if (sort === key) setDirection((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDirection("asc");
    }
  }

  async function mutate(
    eventId: string,
    field: Field,
    body: Record<string, unknown>,
    optimistic: (event: DashboardEventView) => DashboardEventView,
  ) {
    const key = `${eventId}:${field}`;
    if (pending.has(key)) return;

    let previous: DashboardEventView | undefined;
    setEvents((current) =>
      current.map((event) => {
        if (event.id !== eventId) return event;
        previous = event;
        return optimistic(event);
      }),
    );
    setPending((current) => new Set(current).add(key));

    try {
      const result = await api.patch<{
        event: DashboardEventView;
        promoted: boolean;
        demoted: boolean;
      }>(`/api/events/${eventId}`, body);

      // The row is kept either way now — completing an event moves it into the
      // Completed scope rather than removing it from the dashboard.
      setEvents((current) =>
        current.map((event) => (event.id === eventId ? result.event : event)),
      );

      if (result.demoted) {
        toast.success("Returned to open work.");
        router.refresh();
      }

      // Only once the completion has actually landed. Celebrating off the
      // optimistic update would mean confetti for a write that then failed.
      // Completion is the achievement; sending it to C1 is the step after.
      if (field === "complete" && result.event.completedAt) void celebration.check();
    } catch (error) {
      if (previous) {
        const restore = previous;
        setEvents((current) =>
          current.map((event) => (event.id === eventId ? restore : event)),
        );
      }
      toast.error(
        "Unable to update event.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  async function remove(event: DashboardEventView) {
    const label = describeEvent(event);
    if (
      !window.confirm(
        `Delete "${label}"?\n\nThis removes it from the dashboard and from C1. This cannot be undone.`,
      )
    ) {
      return;
    }

    try {
      const result = await api.delete<{ outcome: string }>(`/api/events/${event.id}`);
      setEvents((current) => current.filter((item) => item.id !== event.id));
      toast.success(
        result.outcome === "CANCELLED"
          ? "Event cancelled — its completed review history was kept."
          : "Event deleted.",
      );
      router.refresh();
    } catch (error) {
      toast.error(
        "Unable to delete event.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    }
  }

  /**
   * Sends a completed event into C1.
   *
   * Deliberately not optimistic. This creates review stages and moves the row
   * to another screen; showing it as done before the server agrees would mean
   * unwinding a screenful of state when it fails.
   */
  async function sendToC1(event: DashboardEventView) {
    const key = event.id + ":sendToC1";
    if (pending.has(key)) return;

    setPending((current) => new Set(current).add(key));
    try {
      const result = await api.post<{ event: DashboardEventView; stagesCreated: number }>(
        "/api/events/" + event.id + "/send-to-c1",
        {},
      );

      setEvents((current) =>
        current.map((item) => (item.id === event.id ? result.event : item)),
      );
      toast.success(
        "Sent to C1 — " +
          result.stagesCreated +
          " review stage" +
          (result.stagesCreated === 1 ? "" : "s") +
          " created.",
      );
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not send to C1.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function exportCsv() {
    const csv = toCsv(
      [
        "Date", "Type", "Away Team / Artist", "Home Team", "Venue", "Status",
        "Assigned", "Complete", "Completed At", "Days Since Complete",
        "SeatGeek", "SeatGeek At", "TicketData", "Audited", "Audited At", "Flagged",
      ],
      visible.map((event) => [
        event.eventDate,
        event.eventTypeName,
        event.awayTeam,
        event.homeTeam,
        event.venue,
        event.status,
        event.assigneeName ?? UNASSIGNED_LABEL,
        event.completedAt ? "TRUE" : "FALSE",
        formatBusinessTimestamp(event.completedAt),
        calendarDaysSince(event.completedOn, today) ?? "",
        event.seatGeekCheckedAt ? "TRUE" : "FALSE",
        formatBusinessTimestamp(event.seatGeekCheckedAt),
        event.ticketDataChecked ? "TRUE" : "FALSE",
        event.auditedAt ? "TRUE" : "FALSE",
        formatBusinessTimestamp(event.auditedAt),
        event.flaggedAt ? "TRUE" : "FALSE",
      ]),
    );
    downloadCsv(`event-dashboard-${today}.csv`, csv);
  }

  const filtersActive =
    Boolean(search || typeFilter || assigneeFilter) ||
    mineOnly ||
    flaggedOnly ||
    pendingWork !== null ||
    scope !== "OPEN";

  function clearFilters() {
    setSearch("");
    setTypeFilter("");
    setAssigneeFilter("");
    setMineOnly(false);
    setFlaggedOnly(false);
    setPendingWork(null);
    setScope("OPEN");
  }

  /** The plain outstanding-work view the "open" counter describes. */
  const showOpenWork = clearFilters;

  /*
   * Whether this person may touch the working state of a row.
   *
   * The checkboxes, the flag, the notes and Start are all records of work done
   * on a specific event, and an event has one person accountable for it.
   * Somebody else ticking SeatGeek says *that* person checked SeatGeek, which
   * is either untrue or invisible.
   *
   * Unassigned rows stay open to everybody, or work nobody has claimed would be
   * work nobody may touch. The server enforces the same rule; this only stops
   * offering what it would refuse.
   */
  const mayWorkOn = React.useCallback(
    (assigneeId: string | null) =>
      canManage || assigneeId === null || assigneeId === currentUser.id,
    [canManage, currentUser.id],
  );

  /* ---------------------------------------------------------------------- */
  /* Paging                                                                  */
  /* ---------------------------------------------------------------------- */

  const pageCount =
    pageSize === "ALL" ? 1 : Math.max(1, Math.ceil(visible.length / pageSize));

  /*
   * Filtering resets to the first page, and so does landing past the end.
   *
   * Without this, narrowing a filter while on page 6 shows an empty table with
   * no indication that the rows exist a few pages back — which reads as "no
   * results" and is the single most confusing thing pagination can do.
   */
  React.useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  const paged = React.useMemo(() => {
    if (pageSize === "ALL") return visible;
    const start = page * pageSize;
    return visible.slice(start, start + pageSize);
  }, [visible, page, pageSize]);

  // Somebody sent to a specific row must not land on the page that does not
  // contain it. Page size stays as they left it; only the page moves.
  React.useEffect(() => {
    if (!focusId || pageSize === "ALL") return;
    const index = visible.findIndex((event) => event.id === focusId);
    if (index >= 0) setPage(Math.floor(index / pageSize));
  }, [focusId, visible, pageSize]);

  /*
   * Selection survives filtering, deliberately.
   *
   * Building a set across two or three different filters is a normal way to
   * work — every Yankees fixture, then everything at that one venue — and
   * dropping the selection when the filter changes would make that impossible.
   * The count in the bar is the whole selection, and the review screen names
   * every event in it, so nothing can be applied to a row the person has
   * forgotten is still ticked.
   */
  const selectedVisibleCount = React.useMemo(
    () => visible.reduce((count, event) => count + (selected.has(event.id) ? 1 : 0), 0),
    [visible, selected],
  );

  function toggleSelected(eventId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

  /** Select-all covers what is on screen, never the whole unfiltered board. */
  function toggleAllVisible(select: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const event of visible) {
        if (select) next.add(event.id);
        else next.delete(event.id);
      }
      return next;
    });
  }

  /*
   * Every header counter is counted over open work, so each of these puts the
   * scope back first — clicking "unassigned" while looking at Completed would
   * otherwise land on a number with no relation to the one just pressed.
   *
   * Mine and Unassigned also clear each other. They cannot both hold, so
   * leaving one set while the other is applied guarantees an empty screen.
   */

  function toggleUnassigned() {
    setScope("OPEN");
    setPendingWork(null);
    setMineOnly(false);
    setAssigneeFilter((current) => (current === UNASSIGNED_FILTER ? "" : UNASSIGNED_FILTER));
  }

  function toggleMine() {
    setScope("OPEN");
    setPendingWork(null);
    setAssigneeFilter("");
    setMineOnly((value) => !value);
  }

  function togglePendingWork(next: PendingWork) {
    setScope("OPEN");
    setPendingWork((current) => (current === next ? null : next));
  }

  // The chip counts have to use the same predicate as the filter behind them,
  // or pressing one lands on a different number from the one you pressed.
  const openCount = events.filter((event) => event.completedAt === null).length;
  const awaitingC1Count = events.filter(
    (event) => event.completedAt !== null && event.status === "DASHBOARD",
  ).length;
  const completedCount = events.length - openCount;
  const staleCount = events.filter((event) =>
    isStaleCompletion(event.completedOn, today, stats.staleDays),
  ).length;

  return (
    <Card>
      {celebration.celebrating ? (
        <Celebration
          message={celebration.celebrating.message}
          dark={theme === "dark"}
          onDone={celebration.dismiss}
        />
      ) : null}

      <PageHeader
        title="Event Dashboard"
        subtitle={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {/* Every counter here is a filter you can apply. They all narrow
                within the open-work scope the numbers are counted over, so the
                figure you clicked is the number of rows you land on. */}
            <StatPill
              label="open"
              value={stats.total}
              active={!filtersActive}
              onClick={showOpenWork}
              title="All outstanding work — clears every other filter"
            />
            <StatPill
              label="unassigned"
              value={stats.unassigned}
              active={assigneeFilter === UNASSIGNED_FILTER}
              onClick={toggleUnassigned}
            />
            <StatPill
              label="SeatGeek to do"
              value={stats.seatGeekPending}
              active={pendingWork === "SEATGEEK"}
              onClick={() => togglePendingWork("SEATGEEK")}
            />
            <StatPill
              label="TicketData to do"
              value={stats.ticketDataPending}
              active={pendingWork === "TICKETDATA"}
              onClick={() => togglePendingWork("TICKETDATA")}
            />
            {showAudited ? (
              <StatPill
                label="to audit"
                value={stats.auditPending}
                active={pendingWork === "AUDIT"}
                onClick={() => togglePendingWork("AUDIT")}
              />
            ) : null}
            <StatPill
              label="mine"
              value={stats.mine}
              active={mineOnly}
              onClick={toggleMine}
            />
            {stats.archived > 0 ? (
              <span
                className="text-[11.5px]"
                style={{ color: "var(--ink-subtle)" }}
                title="Events whose date has passed. Removed from the Dashboard and C1; their notes, stages and completion history are retained."
              >
                {stats.archived} archived
              </span>
            ) : null}
            {presence.activeCount > 0 ? (
              <StatPill label="in progress" value={presence.activeCount} tone="success" />
            ) : null}
          </div>
        }
        actions={
          <>
            {columns.hasCustomWidths ? (
              <Button size="sm" variant="ghost" onClick={columns.reset}>
                Reset columns
              </Button>
            ) : null}
            <Button size="sm" onClick={exportCsv} disabled={visible.length === 0}>
              Export CSV
            </Button>
            {canManage ? (
              <>
                <Button
                  size="sm"
                  variant={selecting ? "primary" : "secondary"}
                  aria-pressed={selecting}
                  onClick={() => {
                    setSelecting((on) => !on);
                    setSelected(new Set());
                  }}
                  title="Pick several events and change them together"
                >
                  {selecting ? "Done selecting" : "Bulk actions"}
                </Button>
                <Button size="sm" onClick={() => setImporting(true)}>
                  Bulk import
                </Button>
                <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
                  Add event
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {drilledFrom ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b px-5 py-2 text-[12px]"
          style={{ borderColor: "var(--line)", background: "var(--accent-soft)" }}
        >
          <span style={{ color: "var(--ink)" }}>
            Showing the <strong>{visible.length}</strong> event
            {visible.length === 1 ? "" : "s"} <strong>{drilledFrom.personName}</strong>{" "}
            completed
            {drilledFrom.from ? (
              <>
                {" "}between {formatPlainDateWithWeekday(drilledFrom.from)} and{" "}
                {drilledFrom.to ? formatPlainDateWithWeekday(drilledFrom.to) : "today"}
              </>
            ) : drilledFrom.to ? (
              <> up to {formatPlainDateWithWeekday(drilledFrom.to)}</>
            ) : null}
            .
          </span>
          <Button size="sm" variant="ghost" onClick={() => router.push("/dashboard")}>
            Show the whole board
          </Button>
        </div>
      ) : null}

      <div
        className="flex flex-wrap items-center gap-2 border-b px-5 py-2"
        style={{ borderColor: "var(--line)" }}
      >
        <span
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--ink-subtle)" }}
        >
          Show
        </span>

        <ShortcutChip
          label="Open"
          count={openCount}
          active={scope === "OPEN"}
          onClick={() => setScope("OPEN")}
        />
        <ShortcutChip
          label="All"
          count={events.length}
          active={scope === "ALL"}
          onClick={() => setScope(scope === "ALL" ? "OPEN" : "ALL")}
          title="Open and completed work together. Completed rows stay dimmed so the two are still tellable apart."
        />
        {awaitingC1Count > 0 ? (
          <ShortcutChip
            label="Ready for C1"
            count={awaitingC1Count}
            active={scope === "AWAITING_C1"}
            activeBackground="var(--accent)"
            onClick={() => setScope(scope === "AWAITING_C1" ? "OPEN" : "AWAITING_C1")}
            title="Ticked Complete but not yet sent to C1"
          />
        ) : null}
        <ShortcutChip
          label="Completed"
          count={completedCount}
          active={scope === "COMPLETED"}
          activeBackground="var(--success)"
          onClick={() => setScope(scope === "COMPLETED" ? "OPEN" : "COMPLETED")}
        />
        <ShortcutChip
          label={`Stale ${stats.staleDays}d+`}
          count={staleCount}
          active={scope === "STALE"}
          activeBackground="var(--warn)"
          onClick={() => setScope(scope === "STALE" ? "OPEN" : "STALE")}
          title={`Completed more than ${stats.staleDays} days ago and still sitting here`}
        />

        <span aria-hidden style={{ color: "var(--line-strong)" }}>
          |
        </span>

        <ShortcutChip
          label="⚑ Flagged"
          count={events.filter((event) => event.flaggedAt).length}
          active={flaggedOnly}
          activeBackground="var(--danger)"
          onClick={() => setFlaggedOnly((value) => !value)}
        />
        <ShortcutChip
          label="Mine"
          count={events.filter((event) => event.assigneeId === currentUser.id).length}
          active={mineOnly}
          onClick={toggleMine}
        />
        <ShortcutChip
          label="Unassigned"
          count={events.filter((event) => event.assigneeId === null).length}
          active={assigneeFilter === UNASSIGNED_FILTER}
          onClick={toggleUnassigned}
        />

        {filtersActive ? (
          <Button size="sm" variant="ghost" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <div
        className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5"
        style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
      >
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search team, artist, venue or type…"
          aria-label="Search events"
          className="h-8 w-full max-w-xs"
        />
        <Select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value)}
          aria-label="Filter by type"
          className="h-8 w-auto"
        >
          <option value="">All types</option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>
              {type.emoji ? `${type.emoji} ` : ""}
              {type.name}
            </option>
          ))}
        </Select>
        <Select
          value={assigneeFilter}
          onChange={(event) => setAssigneeFilter(event.target.value)}
          aria-label="Filter by assignee"
          className="h-8 w-auto"
        >
          <option value="">Anyone</option>
          <option value={UNASSIGNED_FILTER}>Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName}
            </option>
          ))}
        </Select>

        <span className="ml-auto text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
          {visible.length} of {events.length} shown
          <span className="ml-2 opacity-70">· drag a column edge to resize</span>
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={
            events.length === 0
              ? "No events yet"
              : scope === "COMPLETED"
                ? "Nothing sent to C1 yet"
                : scope === "STALE"
                  ? `Nothing completed more than ${stats.staleDays} days ago`
                  : // ALL lands here too, which is right: with no status filter
                    // applied, an empty result can only mean the other filters
                    // excluded everything.
                    "No events match these filters"
          }
          description={
            events.length === 0
              ? canManage
                ? "Add an event, or paste a batch straight from a spreadsheet with Bulk import. Ticking Complete sends an event to C1 staging."
                : "Events are added by a manager or administrator. Once they appear here you can claim, check and flag them."
              : "Try a different search term or clear a filter."
          }
          action={
            events.length > 0 && filtersActive ? (
              <Button onClick={clearFilters}>Clear filters</Button>
            ) : events.length === 0 && canManage ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                Add event
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1620px] border-collapse">
            <thead
              className="sticky top-0 z-10"
              style={{ background: "var(--surface)", boxShadow: "0 1px 0 var(--line)" }}
            >
              <tr>
                {selecting ? (
                  <Th className="w-[2.5rem]">
                    <input
                      type="checkbox"
                      aria-label="Select every event matching the filters"
                      // Everything the filters match, not just this page. A
                      // 250-row selection built page by page would be nobody's
                      // idea of a bulk action — and the review screen names
                      // every event before anything is applied.
                      title="Select every event matching the filters, across all pages"
                      // Indeterminate when the selection is a strict subset, so
                      // "some are selected" never looks like "none are".
                      ref={(node) => {
                        if (node) {
                          node.indeterminate =
                            selectedVisibleCount > 0 && selectedVisibleCount < visible.length;
                        }
                      }}
                      checked={visible.length > 0 && selectedVisibleCount === visible.length}
                      onChange={(event) => toggleAllVisible(event.target.checked)}
                    />
                  </Th>
                ) : null}
                <ResizableTh columnKey="date" label="Date" sortKey="eventDate" sort={sort} direction={direction} onSort={toggleSort} columns={columns} className="w-[9.5rem]" />
                <ResizableTh columnKey="type" label="Type" sortKey="eventTypeName" sort={sort} direction={direction} onSort={toggleSort} columns={columns} className="w-[7rem]" />
                <ResizableTh columnKey="away" label="Away Team / Artist" sortKey="awayTeam" sort={sort} direction={direction} onSort={toggleSort} columns={columns} className="w-[11.5rem]" />
                <ResizableTh columnKey="home" label="Home Team" sortKey="homeTeam" sort={sort} direction={direction} onSort={toggleSort} columns={columns} className="w-[11.5rem]" />
                <ResizableTh columnKey="venue" label="Venue" sortKey="venue" sort={sort} direction={direction} onSort={toggleSort} columns={columns} className="w-[10rem]" />
                <ResizableTh columnKey="progress" label="In progress" columns={columns} className="w-[8rem]" />
                <ResizableTh columnKey="assigned" label="Assigned" sortKey="assigneeName" sort={sort} direction={direction} onSort={toggleSort} columns={columns} className="w-[10rem]" />
                <ResizableTh columnKey="flag" label="Flag" columns={columns} className="w-[6.5rem]" />
                <ResizableTh columnKey="complete" label="Complete" columns={columns} className="w-[11rem]" />
                <ResizableTh columnKey="seatgeek" label="SeatGeek" columns={columns} className="w-[7.5rem]" />
                <ResizableTh columnKey="ticketdata" label="TicketData" columns={columns} className="w-[5.5rem]" />
                <ResizableTh columnKey="sendtoc1" label="To C1" columns={columns} className="w-[7rem]" />
                <ResizableTh columnKey="notes" label="Notes" columns={columns} className="w-[14rem]" />
                {showAudited ? (
                  <ResizableTh columnKey="audited" label="Audited" columns={columns} className="w-[7.5rem]" />
                ) : null}
                {showActions ? (
                  <ResizableTh columnKey="actions" label="Actions" columns={columns} className="w-[6rem]" />
                ) : null}
              </tr>
            </thead>
            <tbody>
              {paged.map((event, rowIndex) => {
                const others = (presence.byEvent.get(event.id) ?? []).filter(
                  (entry) => entry.userId !== currentUser.id,
                );
                const working = presence.isWorking(event.id);
                const mayWork = mayWorkOn(event.assigneeId);
                const promoted = event.status === "C1" || event.status === "COMPLETED";
                const days = daysUntilEvent(event.eventDate, today);
                const sinceComplete = calendarDaysSince(event.completedOn, today);
                const staleComplete = isStaleCompletion(
                  event.completedOn,
                  today,
                  stats.staleDays,
                );
                const noteCount = event.noteCount + (noteCounts[event.id] ?? 0);

                return (
                  <tr
                    key={event.id}
                    id={rowElementId(event.id)}
                    className={cn(
                      "border-t align-top transition-colors",
                      working || others.length > 0 ? "jpd-live-row" : "hover:brightness-[0.99]",
                    )}
                    style={{
                      borderColor: "var(--line)",
                      // Finished rows are dimmed so that, when Completed is
                      // shown alongside open work, the two are distinguishable
                      // without reading anything. Keyed on the tick rather than
                      // on being in C1: an event that was unticked is live work
                      // again and must not look retired just because its review
                      // is still running.
                      opacity:
                        event.completedAt !== null && scope !== "COMPLETED" ? 0.72 : 1,
                      /*
                       * Optional banding, off by default.
                       *
                       * Skipped entirely on a live row: that one already carries
                       * a colour meaning "somebody is on this", and a stripe
                       * underneath it either fights the meaning or wins.
                       */
                      // backgroundColor rather than the `background` shorthand:
                      // the shorthand also resets clip, origin and repeat, which
                      // is more than is wanted and more to go wrong on a <tr>.
                      ...(stripeRows && rowIndex % 2 === 1 && !working && others.length === 0
                        ? { backgroundColor: "var(--canvas)" }
                        : {}),
                    }}
                  >
                    {selecting ? (
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${event.awayTeam ?? event.eventTypeName}`}
                          checked={selected.has(event.id)}
                          onChange={() => toggleSelected(event.id)}
                        />
                      </Td>
                    ) : null}

                    <Td>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">
                          {formatPlainDateWithWeekday(event.eventDate)}
                        </span>
                        <span className="text-[10.5px]" style={{ color: "var(--ink-subtle)" }}>
                          {event.eventDate}
                        </span>
                        <LegacyBadge source={event.legacySource} />
                        {promoted ? <Badge tone="success">In C1</Badge> : null}
                        {/* Past events are archived off the board, so the only
                            date state left worth flagging is "coming up soon". */}
                        {!promoted && days <= 7 ? (
                          <Badge tone={days <= 2 ? "danger" : "warn"}>
                            {days === 0 ? "Today" : `${days}d away`}
                          </Badge>
                        ) : null}
                      </div>
                    </Td>

                    <Td>
                      <span className="flex items-center gap-1.5">
                        {event.eventTypeEmoji ? (
                          <span aria-hidden className="text-[14px] leading-none">
                            {event.eventTypeEmoji}
                          </span>
                        ) : null}
                        {event.eventTypeName}
                      </span>
                    </Td>

                    <Td>{event.awayTeam ?? <Muted>—</Muted>}</Td>
                    <Td>{event.homeTeam ?? <Muted>—</Muted>}</Td>
                    <Td className="text-[12px]">{event.venue ?? <Muted>—</Muted>}</Td>

                    <Td>
                      <InProgressButton
                        eventId={event.id}
                        working={working}
                        others={others}
                        pending={presence.pendingEventId === event.id}
                        canStart={mayWork}
                        assigned={event.assigneeId !== null}
                        onToggle={presence.setWorking}
                      />
                    </Td>

                    <Td>
                      <CellSelect
                        aria-label="Assigned"
                        value={event.assigneeId ?? ""}
                        pending={isPending(event.id, "assigneeId")}
                        // A regular user may claim an unassigned row and
                        // nothing else — not release it, not pass it on.
                        disabled={
                          isPending(event.id, "assigneeId") ||
                          (!canManage && event.assigneeId !== null)
                        }
                        title={
                          !canManage && event.assigneeId !== null
                            ? "Only a manager can change who this is assigned to."
                            : undefined
                        }
                        onChange={(e) =>
                          mutate(event.id, "assigneeId", { assigneeId: e.target.value || null }, (item) => ({
                            ...item,
                            assigneeId: e.target.value || null,
                          }))
                        }
                      >
                        <option value="" disabled={!canManage}>
                          {UNASSIGNED_LABEL}
                        </option>
                        {activeUsers.map((user) => (
                          <option
                            key={user.id}
                            value={user.id}
                            disabled={!canManage && user.id !== currentUser.id}
                          >
                            {user.displayName}
                          </option>
                        ))}
                      </CellSelect>
                      {event.assigneeName ? (
                        <UserChip
                          name={event.assigneeName}
                          color={event.assigneeColor ?? "#64748b"}
                          className="mt-0.5 px-1.5 text-[10.5px]"
                        />
                      ) : null}
                    </Td>

                    <Td>
                      <FlagControl
                        eventId={event.id}
                        flaggedAt={event.flaggedAt}
                        flaggedByName={event.flaggedByName}
                        flagReason={event.flagReason}
                        flagFixedAt={event.flagFixedAt}
                        flagFixedByName={event.flagFixedByName}
                        canResolve={canManage}
                        canWork={mayWorkOn(event.assigneeId)}
                        onChanged={() => router.refresh()}
                      />
                    </Td>

                    <Td>
                      <div className="flex flex-col gap-1">
                        <Checkbox
                          label="Complete"
                          checked={event.completedAt !== null}
                          disabled={isPending(event.id, "complete") || !mayWork}
                          pending={isPending(event.id, "complete")}
                          onChange={(e) =>
                            mutate(event.id, "complete", { complete: e.target.checked }, (item) => ({
                              ...item,
                              completedAt: e.target.checked ? new Date().toISOString() : null,
                            }))
                          }
                        />
                        {/* Two lines whichever state this is in, so ticking
                            Complete does not grow the row and shunt everything
                            below it down. The age sits beside the timestamp
                            rather than under it — it is the same fact told two
                            ways, and it buys back the line. */}
                        {event.completedAt ? (
                          <>
                            <span className="flex items-center gap-1.5 whitespace-nowrap">
                              <Stamp
                                at={event.completedAt}
                                byName={event.completedByName}
                                byColor={event.completedByColor}
                              />
                              {sinceComplete !== null ? (
                                <span
                                  className="text-[10px]"
                                  style={{
                                    color: staleComplete ? "var(--warn)" : "var(--ink-subtle)",
                                  }}
                                  title={
                                    staleComplete
                                      ? `Completed ${sinceComplete} days ago — over the ${stats.staleDays}-day threshold`
                                      : undefined
                                  }
                                >
                                  {sinceComplete === 0 ? "today" : `${sinceComplete}d ago`}
                                  {staleComplete ? " ⚠" : ""}
                                </span>
                              ) : null}
                            </span>
                            <CompletionHistory
                              eventId={event.id}
                              label={describeEvent(event)}
                            />
                          </>
                        ) : (
                          <>
                            <span className="text-[10px]" style={{ color: "var(--ink-subtle)" }}>
                              not done yet
                            </span>
                            <span aria-hidden className="invisible text-[10px]">
                              &nbsp;
                            </span>
                          </>
                        )}
                      </div>
                    </Td>

                    <Td>
                      <div className="flex flex-col gap-1">
                        <Checkbox
                          label="SeatGeek"
                          checked={event.seatGeekCheckedAt !== null}
                          disabled={isPending(event.id, "seatGeekChecked") || !mayWork}
                          pending={isPending(event.id, "seatGeekChecked")}
                          onChange={(e) =>
                            mutate(event.id, "seatGeekChecked", { seatGeekChecked: e.target.checked }, (item) => ({
                              ...item,
                              seatGeekCheckedAt: e.target.checked ? new Date().toISOString() : null,
                            }))
                          }
                        />
                        <Stamp
                          at={event.seatGeekCheckedAt}
                          byName={event.seatGeekByName}
                          byColor={event.seatGeekByColor}
                        />
                      </div>
                    </Td>

                    <Td>
                      <div className="flex flex-col gap-1">
                        <Checkbox
                          label="TicketData"
                          checked={event.ticketDataChecked}
                          disabled={isPending(event.id, "ticketDataChecked") || !mayWork}
                          pending={isPending(event.id, "ticketDataChecked")}
                          onChange={(e) =>
                            mutate(event.id, "ticketDataChecked", { ticketDataChecked: e.target.checked }, (item) => ({
                              ...item,
                              ticketDataChecked: e.target.checked,
                            }))
                          }
                        />
                        {/* Always rendered, hidden when there is nobody to
                            show. TicketData records no timestamp, so it cannot
                            use Stamp, but it needs the same reserved height —
                            otherwise ticking it grows the row and pushes every
                            row below it down. */}
                        <span
                          className={cn(
                            "flex items-center gap-1",
                            event.ticketDataChecked && event.ticketDataByColor
                              ? ""
                              : "invisible",
                          )}
                          title={event.ticketDataByName ?? undefined}
                        >
                          <span
                            aria-hidden
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: event.ticketDataByColor ?? "transparent" }}
                          />
                          <span className="text-[10.5px]" aria-hidden>
                            &nbsp;
                          </span>
                          {event.ticketDataChecked && event.ticketDataByName ? (
                            <span className="sr-only">by {event.ticketDataByName}</span>
                          ) : null}
                        </span>
                      </div>
                    </Td>

                    <Td>
                      {event.status === "C1" || event.status === "COMPLETED" ? (
                        <Badge tone="success">In C1</Badge>
                      ) : event.completedAt ? (
                        <Button
                          size="sm"
                          variant="primary"
                          loading={pending.has(event.id + ":sendToC1")}
                          onClick={() => sendToC1(event)}
                          title="Build this event's review checkpoints and move it to C1"
                        >
                          Send to C1
                        </Button>
                      ) : (
                        <span className="text-[11px]" style={{ color: "var(--ink-subtle)" }}>
                          tick Complete first
                        </span>
                      )}
                    </Td>

                    <Td>
                      <NotesCell
                        eventId={event.id}
                        noteCount={noteCount}
                        latest={notes[event.id] ?? null}
                        currentUserId={currentUser.id}
                        isAdmin={isAdmin}
                        canWrite={mayWork}
                        mentionable={activeUsers}
                        onCountChange={(id, delta) =>
                          setNoteCounts((current) => ({
                            ...current,
                            [id]: (current[id] ?? 0) + delta,
                          }))
                        }
                        onLatestChange={(id, note) =>
                          setNotes((current) => {
                            if (!note) {
                              const next = { ...current };
                              delete next[id];
                              return next;
                            }
                            return { ...current, [id]: note };
                          })
                        }
                      />
                    </Td>

                    {showAudited ? (
                      <Td>
                        <div className="flex flex-col gap-1">
                          <Checkbox
                            label="Audited"
                            checked={event.auditedAt !== null}
                            disabled={isPending(event.id, "audited") || !mayWork}
                            pending={isPending(event.id, "audited")}
                            onChange={(e) =>
                              mutate(event.id, "audited", { audited: e.target.checked }, (item) => ({
                                ...item,
                                auditedAt: e.target.checked ? new Date().toISOString() : null,
                              }))
                            }
                          />
                          <Stamp
                            at={event.auditedAt}
                            byName={event.auditedByName}
                            byColor={event.auditedByColor}
                          />
                        </div>
                      </Td>
                    ) : null}

                    {showActions ? (
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(event)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => remove(event)}
                            style={{ color: "var(--danger)" }}
                          >
                            Delete
                          </Button>
                        </div>
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {visible.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-5 py-2"
          style={{ borderColor: "var(--line)" }}
        >
          <span className="text-[11.5px] tabular-nums" style={{ color: "var(--ink-muted)" }}>
            {pageSize === "ALL"
              ? `All ${visible.length}`
              : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, visible.length)} of ${visible.length}`}
          </span>

          {pageCount > 1 ? (
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                Previous
              </Button>
              <span
                className="px-1 text-[11.5px] tabular-nums"
                style={{ color: "var(--ink-muted)" }}
              >
                Page {page + 1} of {pageCount}
              </span>
              <Button
                size="sm"
                disabled={page >= pageCount - 1}
                onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
              >
                Next
              </Button>
            </div>
          ) : null}

          <label className="ml-auto flex items-center gap-1.5 text-[11.5px]"
                 style={{ color: "var(--ink-muted)" }}>
            Rows
            <Select
              aria-label="Rows per page"
              className="h-7 py-0 text-[11.5px]"
              value={String(pageSize)}
              onChange={(event) => {
                const raw = event.target.value;
                setPreference({ pageSize: raw === "ALL" ? "ALL" : (Number(raw) as 50 | 100 | 250) });
                // A new page size makes the old page number meaningless.
                setPage(0);
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={String(size)} value={String(size)}>
                  {pageSizeLabel(size)}
                </option>
              ))}
            </Select>
          </label>

          <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px]"
                 style={{ color: "var(--ink-muted)" }}>
            <input
              type="checkbox"
              checked={stripeRows}
              onChange={(event) => setPreference({ stripeRows: event.target.checked })}
              style={{ accentColor: "var(--accent)" }}
              className="h-3.5 w-3.5"
            />
            Shade alternate rows
          </label>
        </div>
      ) : null}

      {canManage ? (
        <>
          <EventFormDialog
            open={creating || editing !== null}
            event={editing}
            types={types}
            users={activeUsers}
            canAssign={canManage}
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
          <ImportDialog
            open={importing}
            onClose={() => setImporting(false)}
            sheetUrl={importSheetUrl}
            onImported={() => {
              setImporting(false);
              router.refresh();
            }}
          />

          <BulkSelectionBar
            count={selected.size}
            onOpen={() => setBulkOpen(true)}
            onClear={() => setSelected(new Set())}
          />

          {bulkOpen ? (
            <BulkActionsDialog
              eventIds={[...selected]}
              types={types}
              users={users}
              onClose={() => setBulkOpen(false)}
              onApplied={(result) => {
                setBulkOpen(false);
                setSelected(new Set());
                setSelecting(false);
                toast.success(describeBulkResult(result));
                router.refresh();
              }}
            />
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/**
 * What actually happened, in one line.
 *
 * Every outcome is named, including the ones that did nothing. "42 events
 * changed" against 45 selected is the report that makes people stop trusting a
 * bulk action, because the missing three are unaccounted for.
 */
function describeBulkResult(result: BulkResult): string {
  const parts: string[] = [];
  if (result.updated > 0) parts.push(`${result.updated} changed`);
  if (result.deleted > 0) parts.push(`${result.deleted} deleted`);
  if (result.cancelled > 0) parts.push(`${result.cancelled} cancelled`);
  if (result.unchanged > 0) parts.push(`${result.unchanged} already correct`);
  if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
  return parts.length > 0 ? `${parts.join(", ")}.` : "Nothing changed.";
}

function ShortcutChip({
  label,
  count,
  active,
  activeBackground = "var(--accent)",
  title,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  activeBackground?: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition"
      style={{
        borderColor: active ? "transparent" : "var(--line-strong)",
        background: active ? activeBackground : "var(--surface)",
        color: active ? "#fff" : "var(--ink-muted)",
      }}
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

/** A header cell that can be sorted (when given a `sortKey`) and always resized. */
function ResizableTh({
  columnKey,
  label,
  sortKey,
  sort,
  direction,
  onSort,
  columns,
  className,
}: {
  columnKey: string;
  label: string;
  sortKey?: SortKey;
  sort?: SortKey;
  direction?: "asc" | "desc";
  onSort?: (key: SortKey) => void;
  columns: ReturnType<typeof useColumnWidths>;
  className?: string;
}) {
  const sortable = sortKey !== undefined && onSort !== undefined;
  const active = sortable && sort === sortKey;

  return (
    <th
      scope="col"
      aria-sort={
        active ? (direction === "asc" ? "ascending" : "descending") : undefined
      }
      style={columns.widthStyle(columnKey)}
      className={cn("relative whitespace-nowrap px-2.5 py-2 text-left", className)}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition"
          style={{ color: active ? "var(--ink)" : "var(--ink-subtle)" }}
        >
          {label}
          <span aria-hidden className="text-[9px]">
            {active ? (direction === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      ) : (
        <span
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--ink-subtle)" }}
        >
          {label}
        </span>
      )}
      <ResizeHandle columnKey={columnKey} onStart={columns.startResize} />
    </th>
  );
}

function describeEvent(event: DashboardEventView): string {
  if (event.awayTeam && event.homeTeam) {
    return `${event.awayTeam} at ${event.homeTeam}`;
  }
  return event.awayTeam ?? event.homeTeam ?? event.eventTypeName;
}
