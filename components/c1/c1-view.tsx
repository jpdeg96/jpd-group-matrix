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
import { useToast } from "@/components/ui/toast";
import { InProgressButton } from "@/components/presence/in-progress-button";
import { usePresence } from "@/components/presence/use-presence";
import { useLiveRefresh } from "@/components/presence/use-live-refresh";
import { FlagControl } from "@/components/flags/flag-control";
import { NotesCell, type NoteView } from "@/components/notes/notes-cell";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { cn } from "@/lib/ui/cn";
import { downloadCsv, toCsv } from "@/lib/ui/csv";
import { formatPlainDateWithWeekday, type PlainDate } from "@/lib/date/plain-date";
import {
  classifyDueUrgency,
  daysUntilDue,
  isWithinRange,
  resolveDueRange,
  type DueRangeKey,
} from "@/lib/domain/review-schedule";
import {
  reviewStageLabel,
  UNASSIGNED_FILTER,
  UNASSIGNED_LABEL,
} from "@/lib/domain/constants";
import { BulkDueDialog } from "./bulk-due-dialog";
import type { C1RowView } from "@/lib/services/stages";
import type { UserOption } from "@/lib/services/users";

type Field = "assigneeId" | "reviewDue" | "done";

const RANGE_LABELS: Record<DueRangeKey, string> = {
  TODAY: "Today",
  THIS_WEEK: "This week",
  NEXT_WEEK: "Next week",
};

export function C1View({
  rows: initialRows,
  latestNotes: initialNotes,
  users,
  types,
  today,
  stats,
  offsets,
  currentUser,
  canAssign,
  canEditDueDates,
}: {
  rows: C1RowView[];
  latestNotes: Record<string, NoteView>;
  users: UserOption[];
  types: Array<{ id: string; name: string }>;
  today: PlainDate;
  stats: {
    total: number;
    dueToday: number;
    unassigned: number;
    mine: number;
    flagged: number;
    hiddenOverdue: number;
  };
  offsets: number[];
  currentUser: { id: string; role: string };
  canAssign: boolean;
  /** Administrators only — covers both the row picker and the bulk tool. */
  canEditDueDates: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [rows, setRows] = React.useState(initialRows);
  const [notes, setNotes] = React.useState(initialNotes);
  const [noteCounts, setNoteCounts] = React.useState<Record<string, number>>({});
  const [pending, setPending] = React.useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("");
  const [assigneeFilter, setAssigneeFilter] = React.useState("");
  const [stageFilter, setStageFilter] = React.useState("");
  // C1 opens on today's work. The screen exists to answer "what do I review
  // now?", and 500 rows sorted by date answers it far less directly than the
  // handful actually due. Every other range is one click away, and the Today
  // chip stays lit so it is obvious a filter is on rather than that the
  // pipeline is empty.
  const [rangeFilter, setRangeFilter] = React.useState<DueRangeKey | null>("TODAY");
  const [mineOnly, setMineOnly] = React.useState(false);
  const [flaggedOnly, setFlaggedOnly] = React.useState(false);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [bulkOpen, setBulkOpen] = React.useState(false);

  React.useEffect(() => {
    setRows(initialRows);
    setSelected(new Set());
    setNoteCounts({});
  }, [initialRows]);

  React.useEffect(() => {
    setNotes(initialNotes);
  }, [initialNotes]);

  const presence = usePresence("C1", currentUser.id);

  // Somebody else ticked a stage, or an event arrived from the Dashboard.
  useLiveRefresh(presence.revision, pending.size > 0);

  const activeUsers = React.useMemo(
    () => users.filter((user) => user.active),
    [users],
  );

  const visible = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    const range = rangeFilter ? resolveDueRange(rangeFilter, today) : null;

    return rows.filter((row) => {
      if (typeFilter && row.eventTypeId !== typeFilter) return false;
      if (stageFilter && String(row.offsetDays) !== stageFilter) return false;
      if (range && !isWithinRange(row.reviewDue, range)) return false;
      if (flaggedOnly && !row.flaggedAt) return false;
      if (assigneeFilter) {
        const matches =
          assigneeFilter === UNASSIGNED_FILTER
            ? row.assigneeId === null
            : row.assigneeId === assigneeFilter;
        if (!matches) return false;
      }
      if (mineOnly && row.assigneeId !== currentUser.id) return false;
      if (!needle) return true;
      return [row.eventTypeName, row.awayTeam, row.homeTeam, row.venue].some((value) =>
        value?.toLowerCase().includes(needle),
      );
    });
  }, [
    rows, search, typeFilter, stageFilter, assigneeFilter, mineOnly, flaggedOnly,
    rangeFilter, today, currentUser.id,
  ]);

  const isPending = (id: string, field: Field) => pending.has(`${id}:${field}`);

  async function mutate(
    row: C1RowView,
    field: Field,
    body: Record<string, unknown>,
    optimistic: (item: C1RowView) => C1RowView,
  ) {
    const key = `${row.stageId}:${field}`;
    if (pending.has(key)) return;

    let previous: C1RowView | undefined;
    setRows((current) =>
      current.map((item) => {
        if (item.stageId !== row.stageId) return item;
        previous = item;
        return optimistic(item);
      }),
    );
    setPending((current) => new Set(current).add(key));

    try {
      const result = await api.patch<{ advanced: boolean; eventCompleted: boolean }>(
        `/api/stages/${row.stageId}`,
        body,
      );

      if (result.advanced) {
        toast.success(
          result.eventCompleted
            ? "All stages complete — event has left C1."
            : `${reviewStageLabel(row.offsetDays)} done. Next stage is now showing.`,
        );
      }
      router.refresh();
    } catch (error) {
      if (previous) {
        const restore = previous;
        setRows((current) =>
          current.map((item) => (item.stageId === row.stageId ? restore : item)),
        );
      }
      toast.error(
        "Unable to update this stage.",
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
      ["Date", "Type", "Away Team / Artist", "Home Team", "Venue", "Assigned", "Review Due", "Stage", "Progress"],
      visible.map((row) => [
        row.eventDate,
        row.eventTypeName,
        row.awayTeam,
        row.homeTeam,
        row.venue,
        row.assigneeName ?? UNASSIGNED_LABEL,
        row.reviewDue,
        reviewStageLabel(row.offsetDays),
        `${row.resolvedStages}/${row.totalStages}`,
      ]),
    );
    downloadCsv(`c1-staging-${today}.csv`, csv);
  }

  const filtersActive =
    Boolean(search || typeFilter || assigneeFilter || stageFilter || rangeFilter) ||
    mineOnly ||
    flaggedOnly;

  /** The default view, untouched — so its empty state can explain itself. */
  const onlyTodayFilter =
    rangeFilter === "TODAY" &&
    !search &&
    !typeFilter &&
    !assigneeFilter &&
    !stageFilter &&
    !mineOnly &&
    !flaggedOnly;

  function clearFilters() {
    setSearch("");
    setTypeFilter("");
    setAssigneeFilter("");
    setStageFilter("");
    setRangeFilter(null);
    setMineOnly(false);
    setFlaggedOnly(false);
  }

  return (
    <Card>
      <PageHeader
        title="C1 Staging"
        subtitle={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatPill label="in staging" value={stats.total} />
            <StatPill label="due today" value={stats.dueToday} tone="warn" />
            <StatPill label="unassigned" value={stats.unassigned} />
            <StatPill label="mine" value={stats.mine} />
            {stats.flagged > 0 ? (
              <StatPill label="flagged" value={stats.flagged} tone="danger" />
            ) : null}
            {stats.hiddenOverdue > 0 ? (
              <span
                className="text-[11.5px]"
                style={{ color: "var(--ink-subtle)" }}
                title="Past their review date. Hidden here by design; still in the system and still workable."
              >
                {stats.hiddenOverdue} past-due hidden
              </span>
            ) : null}
            {presence.activeCount > 0 ? (
              <StatPill label="in progress" value={presence.activeCount} tone="success" />
            ) : null}
          </div>
        }
        actions={
          <>
            {canEditDueDates && selected.size > 0 ? (
              <Button size="sm" variant="primary" onClick={() => setBulkOpen(true)}>
                Edit {selected.size} review date{selected.size === 1 ? "" : "s"}
              </Button>
            ) : null}
            <Button size="sm" onClick={exportCsv} disabled={visible.length === 0}>
              Export CSV
            </Button>
          </>
        }
      />

      {/* Date shortcuts sit on their own row, ahead of the fiddlier filters —
          they are the ones people reach for constantly. */}
      <div
        className="flex flex-wrap items-center gap-2 border-b px-5 py-2"
        style={{ borderColor: "var(--line)" }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-subtle)" }}>
          Review due
        </span>
        {(Object.keys(RANGE_LABELS) as DueRangeKey[]).map((key) => {
          const active = rangeFilter === key;
          const count = rows.filter((row) =>
            isWithinRange(row.reviewDue, resolveDueRange(key, today)),
          ).length;

          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => setRangeFilter(active ? null : key)}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition"
              style={{
                borderColor: active ? "transparent" : "var(--line-strong)",
                background: active ? "var(--accent)" : "var(--surface)",
                color: active ? "var(--accent-contrast)" : "var(--ink-muted)",
              }}
            >
              {RANGE_LABELS[key]}
              <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}

        <button
          type="button"
          aria-pressed={flaggedOnly}
          onClick={() => setFlaggedOnly((value) => !value)}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] font-medium transition"
          style={{
            borderColor: flaggedOnly ? "transparent" : "var(--line-strong)",
            background: flaggedOnly ? "var(--danger)" : "var(--surface)",
            color: flaggedOnly ? "#fff" : "var(--ink-muted)",
          }}
        >
          ⚑ Flagged
          <span className="tabular-nums opacity-70">
            {rows.filter((row) => row.flaggedAt).length}
          </span>
        </button>

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
          aria-label="Search staging"
          className="h-8 w-full max-w-xs"
        />
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by type" className="h-8 w-auto">
          <option value="">All types</option>
          {types.map((type) => (
            <option key={type.id} value={type.id}>{type.name}</option>
          ))}
        </Select>
        <Select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} aria-label="Filter by stage" className="h-8 w-auto">
          <option value="">All stages</option>
          {offsets.map((offset) => (
            <option key={offset} value={String(offset)}>{reviewStageLabel(offset)}</option>
          ))}
        </Select>
        <Select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} aria-label="Filter by assignee" className="h-8 w-auto">
          <option value="">Anyone</option>
          <option value={UNASSIGNED_FILTER}>Unassigned</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>{user.displayName}</option>
          ))}
        </Select>
        <label
          className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-[12px]"
          style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
        >
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(event) => setMineOnly(event.target.checked)}
            style={{ accentColor: "var(--accent)" }}
            className="h-3.5 w-3.5"
          />
          My work
        </label>

        <span className="ml-auto text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
          {visible.length} of {rows.length} shown
        </span>
      </div>

      <div
        className="border-b px-5 py-1.5 text-[11.5px]"
        style={{ borderColor: "var(--line)", color: "var(--ink-subtle)" }}
      >
        Each event shows only its current review stage. Ticking Done advances it
        to the next one; when every stage is done the event leaves C1.
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={
            rows.length === 0
              ? "Nothing in staging"
              : onlyTodayFilter
                ? "Nothing due today"
                : "No rows match these filters"
          }
          description={
            rows.length === 0
              ? "Events arrive here when someone ticks Complete on the Event Dashboard."
              : onlyTodayFilter
                ? // Distinguishing "no work today" from "your filters hid it" is
                  // the difference between a clear afternoon and a broken screen.
                  `${stats.total} event${stats.total === 1 ? "" : "s"} are in staging with later review dates.`
                : "Try a wider date range or clear a filter."
          }
          action={
            onlyTodayFilter ? (
              <Button onClick={() => setRangeFilter(null)}>Show every date</Button>
            ) : filtersActive ? (
              <Button onClick={clearFilters}>Clear filters</Button>
            ) : null
          }
        />
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1620px] border-collapse">
            <thead className="sticky top-0 z-10" style={{ background: "var(--surface)", boxShadow: "0 1px 0 var(--line)" }}>
              <tr>
                {canEditDueDates ? (
                  <Th className="w-[2.5rem]">
                    <input
                      type="checkbox"
                      aria-label="Select all shown"
                      checked={visible.length > 0 && selected.size === visible.length}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? new Set(visible.map((row) => row.stageId))
                            : new Set(),
                        )
                      }
                      style={{ accentColor: "var(--accent)" }}
                      className="h-3.5 w-3.5"
                    />
                  </Th>
                ) : null}
                <Th className="w-[7.5rem]">Review Due</Th>
                <Th className="w-[5rem]">Stage</Th>
                <Th className="w-[9.5rem]">Date</Th>
                <Th className="w-[6.5rem]">Type</Th>
                <Th className="w-[11.5rem]">Away Team / Artist</Th>
                <Th className="w-[11.5rem]">Home Team</Th>
                <Th className="w-[10rem]">Venue</Th>
                <Th className="w-[14rem]">Notes</Th>
                <Th className="w-[8.5rem]">In progress</Th>
                <Th className="w-[10rem]">Assigned</Th>
                <Th className="w-[7rem]">Flag</Th>
                <Th className="w-[5rem]">Done</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const others = (presence.byEvent.get(row.eventId) ?? []).filter(
                  (entry) => entry.userId !== currentUser.id,
                );
                const working = presence.isWorking(row.eventId);
                const urgency = classifyDueUrgency(row.reviewDue, today);
                // Overdue rows are filtered out server-side, and anything
                // further out than a few days needs no badge at all.
                const showUrgency = urgency !== "OVERDUE" && urgency !== "SCHEDULED";

                return (
                  <tr
                    key={row.stageId}
                    className={cn(
                      "border-t align-top transition-colors",
                      working || others.length > 0 ? "jpd-live-row" : "hover:brightness-[0.99]",
                    )}
                    style={{ borderColor: "var(--line)" }}
                  >
                    {canEditDueDates ? (
                      <Td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.awayTeam ?? row.eventTypeName}`}
                          checked={selected.has(row.stageId)}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(row.stageId);
                              else next.delete(row.stageId);
                              return next;
                            })
                          }
                          style={{ accentColor: "var(--accent)" }}
                          className="mt-1 h-3.5 w-3.5"
                        />
                      </Td>
                    ) : null}

                    <Td>
                      {/* Compact by design: the weekday-and-date line plus a
                          short relative badge, with the picker sized to its own
                          content rather than stretched to the column. */}
                      <div className="flex flex-col items-start gap-1">
                        <span className="whitespace-nowrap font-medium">
                          {formatPlainDateWithWeekday(row.reviewDue)}
                        </span>
                        {showUrgency ? (
                          <Badge tone={urgency === "TOMORROW" ? "warn" : "accent"}>
                            {shortDueLabel(row.reviewDue, today)}
                          </Badge>
                        ) : null}
                        {row.reviewDueOverridden ? (
                          <span
                            className="text-[10px]"
                            style={{ color: "var(--ink-subtle)" }}
                            title="Set by hand, so it is exempt from the calculated schedule."
                          >
                            manual
                          </span>
                        ) : null}

                        {/* The event date moved after this stage was created,
                            so the stored deadline no longer matches the
                            schedule. Nothing is rewritten automatically — an
                            administrator decides. */}
                        {row.scheduleDrifted ? (
                          <span
                            className="flex flex-col items-start gap-0.5 rounded px-1 py-0.5"
                            style={{ background: "var(--warn-soft)" }}
                            title={`The event date changed. The schedule now gives ${row.expectedReviewDue} for ${reviewStageLabel(row.offsetDays)}.`}
                          >
                            <span
                              className="text-[10px] font-semibold"
                              style={{ color: "var(--warn)" }}
                            >
                              ⚠ schedule says {row.expectedReviewDue}
                            </span>
                            {canEditDueDates ? (
                              <button
                                type="button"
                                disabled={isPending(row.stageId, "reviewDue")}
                                onClick={() =>
                                  void mutate(
                                    row,
                                    "reviewDue",
                                    { reviewDue: row.expectedReviewDue },
                                    (item) => ({
                                      ...item,
                                      reviewDue: item.expectedReviewDue,
                                      reviewDueOverridden: true,
                                      scheduleDrifted: false,
                                    }),
                                  )
                                }
                                className="text-[10px] underline-offset-2 hover:underline disabled:opacity-50"
                                style={{ color: "var(--warn)" }}
                              >
                                use it
                              </button>
                            ) : null}
                          </span>
                        ) : null}
                        {/* Only administrators can move a deadline. Everyone
                            else sees the date as plain text rather than a
                            disabled control they will keep trying to use. */}
                        {canEditDueDates ? (
                          <Input
                            type="date"
                            aria-label="Review due date"
                            value={row.reviewDue}
                            disabled={isPending(row.stageId, "reviewDue")}
                            onChange={(event) => {
                              if (!event.target.value) return;
                              void mutate(row, "reviewDue", { reviewDue: event.target.value }, (item) => ({
                                ...item,
                                reviewDue: event.target.value as PlainDate,
                                reviewDueOverridden: true,
                              }));
                            }}
                            className="h-6 w-[7rem] px-1 text-[10.5px]"
                          />
                        ) : (
                          <span
                            className="text-[10.5px] tabular-nums"
                            style={{ color: "var(--ink-subtle)" }}
                          >
                            {row.reviewDue}
                          </span>
                        )}
                      </div>
                    </Td>

                    <Td>
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className="inline-flex rounded border px-1.5 py-px font-mono text-[11px] font-semibold"
                          style={{ borderColor: "var(--line-strong)", background: "var(--canvas)" }}
                        >
                          {reviewStageLabel(row.offsetDays)}
                        </span>
                        <span className="text-[10px] tabular-nums" style={{ color: "var(--ink-subtle)" }}>
                          {row.resolvedStages}/{row.totalStages} done
                        </span>
                      </div>
                    </Td>

                    <Td>
                      <div className="flex flex-col items-start gap-1">
                        <span>{formatPlainDateWithWeekday(row.eventDate)}</span>
                        <LegacyBadge source={row.legacySource} />
                      </div>
                    </Td>
                    <Td>
                      <span className="flex items-center gap-1.5">
                        {row.eventTypeEmoji ? (
                          <span aria-hidden className="text-[14px] leading-none">
                            {row.eventTypeEmoji}
                          </span>
                        ) : null}
                        {row.eventTypeName}
                      </span>
                    </Td>
                    <Td>{row.awayTeam ?? <Muted>—</Muted>}</Td>
                    <Td>{row.homeTeam ?? <Muted>—</Muted>}</Td>
                    <Td className="text-[12px]">{row.venue ?? <Muted>—</Muted>}</Td>

                    {/* The same cell the Dashboard uses. A note belongs to the
                        event, so anything left before the event reached review
                        is already here — this is the column that was missing,
                        not the data. */}
                    <Td>
                      <NotesCell
                        eventId={row.eventId}
                        noteCount={row.noteCount + (noteCounts[row.eventId] ?? 0)}
                        latest={notes[row.eventId] ?? null}
                        currentUserId={currentUser.id}
                        isAdmin={currentUser.role === "ADMIN"}
                        onCountChange={(eventId, delta) =>
                          setNoteCounts((current) => ({
                            ...current,
                            [eventId]: (current[eventId] ?? 0) + delta,
                          }))
                        }
                        onLatestChange={(eventId, note) =>
                          setNotes((current) => {
                            // Deleting the only note leaves no latest, and an
                            // explicit null would render as an empty note
                            // rather than as no note.
                            if (!note) {
                              const next = { ...current };
                              delete next[eventId];
                              return next;
                            }
                            return { ...current, [eventId]: note };
                          })
                        }
                      />
                    </Td>

                    <Td>
                      <InProgressButton
                        eventId={row.eventId}
                        working={working}
                        others={others}
                        pending={presence.pendingEventId === row.eventId}
                        onToggle={presence.setWorking}
                      />
                    </Td>

                    <Td>
                      <CellSelect
                        aria-label="Assigned"
                        value={row.assigneeId ?? ""}
                        pending={isPending(row.stageId, "assigneeId")}
                        // A regular user may claim an unassigned row and
                        // nothing else — not release it, not pass it on.
                        disabled={
                          isPending(row.stageId, "assigneeId") ||
                          (!canAssign && row.assigneeId !== null)
                        }
                        title={
                          !canAssign && row.assigneeId !== null
                            ? "Only a manager can change who this is assigned to."
                            : undefined
                        }
                        onChange={(event) =>
                          mutate(row, "assigneeId", { assigneeId: event.target.value || null }, (item) => ({
                            ...item,
                            assigneeId: event.target.value || null,
                          }))
                        }
                      >
                        <option value="" disabled={!canAssign}>
                          {UNASSIGNED_LABEL}
                        </option>
                        {activeUsers.map((user) => (
                          <option
                            key={user.id}
                            value={user.id}
                            // Claiming is the only move a regular user has, so
                            // everyone else is greyed out rather than offered
                            // and then rejected by the server.
                            disabled={!canAssign && user.id !== currentUser.id}
                          >
                            {user.displayName}
                          </option>
                        ))}
                      </CellSelect>
                      {row.assigneeName ? (
                        <UserChip
                          name={row.assigneeName}
                          color={row.assigneeColor ?? "#64748b"}
                          className="mt-0.5 px-1.5 text-[10.5px]"
                        />
                      ) : null}
                    </Td>

                    <Td>
                      <FlagControl
                        eventId={row.eventId}
                        flaggedAt={row.flaggedAt}
                        flaggedByName={row.flaggedByName}
                        flagReason={row.flagReason}
                        canResolve={canAssign}
                        onChanged={() => router.refresh()}
                      />
                    </Td>

                    <Td>
                      <Checkbox
                        label={`Mark ${reviewStageLabel(row.offsetDays)} done`}
                        checked={false}
                        disabled={isPending(row.stageId, "done")}
                        pending={isPending(row.stageId, "done")}
                        onChange={(event) => {
                          if (!event.target.checked) return;
                          void mutate(row, "done", { done: true }, (item) => item);
                        }}
                      />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canEditDueDates ? (
        <BulkDueDialog
          open={bulkOpen}
          stageIds={[...selected]}
          today={today}
          onClose={() => setBulkOpen(false)}
          onApplied={() => {
            setBulkOpen(false);
            setSelected(new Set());
            router.refresh();
          }}
        />
      ) : null}
    </Card>
  );
}

/** `Today`, `Tomorrow`, `2d` — short enough not to widen the column. */
function shortDueLabel(reviewDue: PlainDate, today: PlainDate): string {
  const days = daysUntilDue(reviewDue, today);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days}d`;
}
