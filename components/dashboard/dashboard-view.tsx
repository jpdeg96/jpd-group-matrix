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
  UserChip,
} from "@/components/ui/primitives";
import { Stamp } from "@/components/ui/stamp";
import { ResizeHandle, useColumnWidths } from "@/components/ui/use-column-widths";
import { useToast } from "@/components/ui/toast";
import { NotesCell, type NoteView } from "@/components/notes/notes-cell";
import { InProgressButton } from "@/components/presence/in-progress-button";
import { usePresence } from "@/components/presence/use-presence";
import { useCompletionCelebration } from "./use-completion-celebration";
import { Celebration } from "@/components/ui/celebration";
import { useTheme } from "@/components/ui/theme";
import { FlagControl } from "@/components/flags/flag-control";
import { TicketLinks } from "@/components/tickets/ticket-links";
import { CompletionHistory } from "./completion-history";
import { EventFormDialog } from "./event-form-dialog";
import { ImportDialog } from "./import-dialog";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { cn } from "@/lib/ui/cn";
import { downloadCsv, toCsv } from "@/lib/ui/csv";
import { comparePlainDates, formatPlainDateWithWeekday, type PlainDate } from "@/lib/date/plain-date";
import { formatBusinessTimestamp } from "@/lib/date/business-time";
import {
  daysSince,
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
type Scope = "OPEN" | "COMPLETED" | "STALE";

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
  linkOptions,
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
  linkOptions: { seatGeek: boolean; stubHub: boolean };
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
  const [scope, setScope] = React.useState<Scope>("OPEN");
  const [sort, setSort] = React.useState<SortKey>("eventDate");
  const [direction, setDirection] = React.useState<"asc" | "desc">("asc");
  const [editing, setEditing] = React.useState<DashboardEventView | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  const columns = useColumnWidths("dashboard");

  React.useEffect(() => {
    setEvents(initialEvents);
    setNoteCounts({});
  }, [initialEvents]);

  React.useEffect(() => {
    setNotes(initialNotes);
  }, [initialNotes]);

  const presence = usePresence("DASHBOARD", currentUser.id);
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
      // Promoted events stay on the dashboard as the permanent record, but are
      // hidden by default so the screen shows outstanding work.
      const promoted = event.status === "C1" || event.status === "COMPLETED";
      if (scope === "OPEN" && promoted) return false;
      if (scope === "COMPLETED" && !promoted) return false;
      if (scope === "STALE" && !isStaleCompletion(event.completedAt, now, stats.staleDays)) {
        return false;
      }

      if (typeFilter && event.eventTypeId !== typeFilter) return false;
      if (flaggedOnly && !event.flaggedAt) return false;
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

    return [...filtered].sort((a, b) => {
      if (sort === "eventDate") {
        return factor * comparePlainDates(a.eventDate, b.eventDate);
      }
      const left = (a[sort] ?? "").toLowerCase();
      const right = (b[sort] ?? "").toLowerCase();
      if (left === right) return comparePlainDates(a.eventDate, b.eventDate);
      return factor * (left < right ? -1 : 1);
    });
  }, [
    events, search, typeFilter, assigneeFilter, mineOnly, flaggedOnly, scope,
    sort, direction, currentUser.id, stats.staleDays,
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

      if (result.promoted) toast.success("Sent to C1 staging.");
      if (result.demoted) toast.success("Returned to open work.");
      if (result.promoted || result.demoted) router.refresh();

      // Only once the completion has actually landed. Celebrating off the
      // optimistic update would mean confetti for a write that then failed.
      if (result.promoted) void celebration.check();
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
        daysSince(event.completedAt) ?? "",
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
    scope !== "OPEN";

  function clearFilters() {
    setSearch("");
    setTypeFilter("");
    setAssigneeFilter("");
    setMineOnly(false);
    setFlaggedOnly(false);
    setScope("OPEN");
  }

  const openCount = events.filter((event) => event.status === "DASHBOARD").length;
  const completedCount = events.length - openCount;
  const staleCount = events.filter((event) =>
    isStaleCompletion(event.completedAt, new Date(), stats.staleDays),
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
            <StatPill label="open" value={stats.total} />
            <StatPill label="unassigned" value={stats.unassigned} />
            <StatPill label="SeatGeek to do" value={stats.seatGeekPending} />
            <StatPill label="TicketData to do" value={stats.ticketDataPending} />
            {showAudited ? (
              <StatPill label="to audit" value={stats.auditPending} />
            ) : null}
            <StatPill label="mine" value={stats.mine} />
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
          onClick={() => setMineOnly((value) => !value)}
        />
        <ShortcutChip
          label="Unassigned"
          count={events.filter((event) => event.assigneeId === null).length}
          active={assigneeFilter === UNASSIGNED_FILTER}
          onClick={() =>
            setAssigneeFilter((current) =>
              current === UNASSIGNED_FILTER ? "" : UNASSIGNED_FILTER,
            )
          }
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
                  : "No events match these filters"
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
                <ResizableTh columnKey="date" label="Date" sortKey="eventDate" sort={sort} direction={direction} onSort={toggleSort} columns={columns} className="w-[9.5rem]" />
                <ResizableTh columnKey="type" label="Type" sortKey="eventTypeName" sort={sort} direction={direction} onSort={toggleSort} columns={columns} className="w-[7rem]" />
                <ResizableTh columnKey="away" label="Away Team / Artist" sortKey="awayTeam" sort={sort} direction={direction} onSort={toggleSort} columns={columns} className="w-[11.5rem]" />
                <ResizableTh columnKey="home" label="Home Team" sortKey="homeTeam" sort={sort} direction={direction} onSort={toggleSort} columns={columns} className="w-[11.5rem]" />
                <ResizableTh columnKey="venue" label="Venue" sortKey="venue" sort={sort} direction={direction} onSort={toggleSort} columns={columns} className="w-[10rem]" />
                <ResizableTh columnKey="tickets" label="Tickets" columns={columns} className="w-[8.5rem]" />
                <ResizableTh columnKey="progress" label="In progress" columns={columns} className="w-[8rem]" />
                <ResizableTh columnKey="assigned" label="Assigned" sortKey="assigneeName" sort={sort} direction={direction} onSort={toggleSort} columns={columns} className="w-[10rem]" />
                <ResizableTh columnKey="flag" label="Flag" columns={columns} className="w-[6.5rem]" />
                <ResizableTh columnKey="complete" label="Complete" columns={columns} className="w-[8rem]" />
                <ResizableTh columnKey="seatgeek" label="SeatGeek" columns={columns} className="w-[7.5rem]" />
                <ResizableTh columnKey="ticketdata" label="TicketData" columns={columns} className="w-[5.5rem]" />
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
              {visible.map((event) => {
                const others = (presence.byEvent.get(event.id) ?? []).filter(
                  (entry) => entry.userId !== currentUser.id,
                );
                const working = presence.isWorking(event.id);
                const promoted = event.status === "C1" || event.status === "COMPLETED";
                const days = daysUntilEvent(event.eventDate, today);
                const sinceComplete = daysSince(event.completedAt);
                const staleComplete = isStaleCompletion(
                  event.completedAt,
                  new Date(),
                  stats.staleDays,
                );
                const noteCount = event.noteCount + (noteCounts[event.id] ?? 0);

                return (
                  <tr
                    key={event.id}
                    className={cn(
                      "border-t align-top transition-colors",
                      working || others.length > 0 ? "jpd-live-row" : "hover:brightness-[0.99]",
                    )}
                    style={{
                      borderColor: "var(--line)",
                      // Promoted rows are dimmed so that, when Completed is
                      // shown alongside open work, the two are distinguishable
                      // without reading the status.
                      opacity: promoted && scope !== "COMPLETED" ? 0.72 : 1,
                    }}
                  >
                    <Td>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">
                          {formatPlainDateWithWeekday(event.eventDate)}
                        </span>
                        <span className="text-[10.5px]" style={{ color: "var(--ink-subtle)" }}>
                          {event.eventDate}
                        </span>
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
                      <TicketLinks event={event} options={linkOptions} />
                    </Td>

                    <Td>
                      <InProgressButton
                        eventId={event.id}
                        working={working}
                        others={others}
                        pending={presence.pendingEventId === event.id}
                        onToggle={presence.setWorking}
                      />
                    </Td>

                    <Td>
                      <CellSelect
                        aria-label="Assigned"
                        value={event.assigneeId ?? ""}
                        pending={isPending(event.id, "assigneeId")}
                        disabled={isPending(event.id, "assigneeId")}
                        onChange={(e) =>
                          mutate(event.id, "assigneeId", { assigneeId: e.target.value || null }, (item) => ({
                            ...item,
                            assigneeId: e.target.value || null,
                          }))
                        }
                      >
                        <option value="">{UNASSIGNED_LABEL}</option>
                        {activeUsers.map((user) => (
                          <option
                            key={user.id}
                            value={user.id}
                            disabled={
                              !canManage &&
                              user.id !== currentUser.id &&
                              event.assigneeId !== null
                            }
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
                        canResolve={canManage}
                        onChanged={() => router.refresh()}
                      />
                    </Td>

                    <Td>
                      <div className="flex flex-col gap-1">
                        <Checkbox
                          label="Complete"
                          checked={event.completedAt !== null}
                          disabled={isPending(event.id, "complete")}
                          pending={isPending(event.id, "complete")}
                          onChange={(e) =>
                            mutate(event.id, "complete", { complete: e.target.checked }, (item) => ({
                              ...item,
                              completedAt: e.target.checked ? new Date().toISOString() : null,
                            }))
                          }
                        />
                        {event.completedAt ? (
                          <>
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
                            <CompletionHistory
                              eventId={event.id}
                              label={describeEvent(event)}
                            />
                          </>
                        ) : (
                          <span className="text-[10px]" style={{ color: "var(--ink-subtle)" }}>
                            sends to C1
                          </span>
                        )}
                      </div>
                    </Td>

                    <Td>
                      <div className="flex flex-col gap-1">
                        <Checkbox
                          label="SeatGeek"
                          checked={event.seatGeekCheckedAt !== null}
                          disabled={isPending(event.id, "seatGeekChecked")}
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
                          disabled={isPending(event.id, "ticketDataChecked")}
                          pending={isPending(event.id, "ticketDataChecked")}
                          onChange={(e) =>
                            mutate(event.id, "ticketDataChecked", { ticketDataChecked: e.target.checked }, (item) => ({
                              ...item,
                              ticketDataChecked: e.target.checked,
                            }))
                          }
                        />
                        {event.ticketDataChecked && event.ticketDataByColor ? (
                          <span
                            className="flex items-center gap-1"
                            title={event.ticketDataByName ?? undefined}
                          >
                            <span
                              aria-hidden
                              className="h-2 w-2 rounded-full"
                              style={{ background: event.ticketDataByColor }}
                            />
                            <span className="sr-only">by {event.ticketDataByName}</span>
                          </span>
                        ) : null}
                      </div>
                    </Td>

                    <Td>
                      <NotesCell
                        eventId={event.id}
                        noteCount={noteCount}
                        latest={notes[event.id] ?? null}
                        currentUserId={currentUser.id}
                        isAdmin={isAdmin}
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
                            disabled={isPending(event.id, "audited")}
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
            onImported={() => {
              setImporting(false);
              router.refresh();
            }}
          />
        </>
      ) : null}
    </Card>
  );
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
