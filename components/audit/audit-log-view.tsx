"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Muted,
  PageHeader,
  Select,
  StatPill,
  Td,
  Th,
  UserChip,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError, toQueryString } from "@/lib/ui/api-client";
import { downloadCsv, toCsv } from "@/lib/ui/csv";
import { formatBusinessTimestamp } from "@/lib/date/business-time";
import type { AuditLogEntry } from "@/lib/services/audit-log";
import type { UserOption } from "@/lib/services/users";

const ENTITY_TYPES = [
  "EVENT",
  "REVIEW_STAGE",
  "EVENT_NOTE",
  "EVENT_TYPE",
  "USER",
  "SETTINGS",
  "IMPERSONATION",
  "MAINTENANCE",
] as const;

/** Actions that deserve to stand out when scanning. */
const ACTION_TONE: Record<string, "danger" | "warn" | "success" | "neutral"> = {
  DELETED: "danger",
  CANCELLED: "danger",
  FLAGGED: "danger",
  FLAG_RESOLVED: "success",
  STAGE_DONE: "success",
  PROMOTED_TO_C1: "success",
  CREATED: "neutral",
  UPDATED: "neutral",
  BULK_IMPORT: "warn",
  BULK_REVIEW_DUE: "warn",
  PASSWORD_CHANGED: "warn",
  STARTED: "warn",
  STOPPED: "warn",
};

export function AuditLogView({
  initialEntries,
  initialCursor,
  actions,
  users,
}: {
  initialEntries: AuditLogEntry[];
  initialCursor: string | null;
  actions: string[];
  users: UserOption[];
}) {
  const toast = useToast();
  const [entries, setEntries] = React.useState(initialEntries);
  const [cursor, setCursor] = React.useState(initialCursor);
  const [entityType, setEntityType] = React.useState("");
  const [action, setAction] = React.useState("");
  const [userId, setUserId] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (append: boolean, nextCursor?: string | null) => {
      setLoading(true);
      try {
        const query = toQueryString({
          entityType,
          action,
          userId,
          search,
          limit: 100,
          cursor: append ? nextCursor : undefined,
        });

        const result = await api.get<{
          entries: AuditLogEntry[];
          nextCursor: string | null;
        }>(`/api/audit${query}`);

        setEntries((current) =>
          append ? [...current, ...result.entries] : result.entries,
        );
        setCursor(result.nextCursor);
      } catch (error) {
        toast.error(
          "Could not load the audit log.",
          error instanceof ApiRequestError ? error.message : undefined,
        );
      } finally {
        setLoading(false);
      }
    },
    [entityType, action, userId, search, toast],
  );

  // Re-query when a filter changes. Search is included, so this debounces
  // naturally through React's batching of keystrokes.
  React.useEffect(() => {
    const timer = setTimeout(() => void load(false), 250);
    return () => clearTimeout(timer);
  }, [load]);

  function exportCsv() {
    const csv = toCsv(
      ["When", "Who", "Viewing as", "Action", "Entity", "Subject", "Before", "After"],
      entries.map((entry) => [
        formatBusinessTimestamp(entry.createdAt),
        entry.actorName,
        entry.impersonatedName,
        entry.action,
        entry.entityType,
        entry.subject,
        entry.oldValue ? JSON.stringify(entry.oldValue) : "",
        entry.newValue ? JSON.stringify(entry.newValue) : "",
      ]),
    );
    downloadCsv("audit-log.csv", csv);
  }

  const impersonatedCount = entries.filter((e) => e.impersonatedName).length;

  return (
    <Card>
      <PageHeader
        title="Audit Log"
        subtitle={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatPill label="entries shown" value={entries.length} />
            {impersonatedCount > 0 ? (
              <StatPill label="while viewing as" value={impersonatedCount} tone="warn" />
            ) : null}
            <span className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              Every change records who really made it, even when an administrator
              was viewing as somebody else.
            </span>
          </div>
        }
        actions={
          <Button size="sm" onClick={exportCsv} disabled={entries.length === 0}>
            Export CSV
          </Button>
        }
      />

      <div
        className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5"
        style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
      >
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search person, action or event…"
          aria-label="Search the audit log"
          className="h-8 w-full max-w-xs"
        />
        <Select
          value={entityType}
          onChange={(event) => setEntityType(event.target.value)}
          aria-label="Filter by entity"
          className="h-8 w-auto"
        >
          <option value="">All entities</option>
          {ENTITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
        <Select
          value={action}
          onChange={(event) => setAction(event.target.value)}
          aria-label="Filter by action"
          className="h-8 w-auto"
        >
          <option value="">All actions</option>
          {actions.map((value) => (
            <option key={value} value={value}>
              {value.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
        <Select
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          aria-label="Filter by person"
          className="h-8 w-auto"
        >
          <option value="">Anyone</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.displayName}
            </option>
          ))}
        </Select>

        {entityType || action || userId || search ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEntityType("");
              setAction("");
              setUserId("");
              setSearch("");
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title={loading ? "Loading…" : "Nothing recorded yet"}
          description="Changes to events, stages, notes, users and settings all appear here."
        />
      ) : (
        <>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1100px] border-collapse">
              <thead
                className="sticky top-0 z-10"
                style={{ background: "var(--surface)", boxShadow: "0 1px 0 var(--line)" }}
              >
                <tr>
                  <Th className="w-[12rem]">When</Th>
                  <Th className="w-[12rem]">Who</Th>
                  <Th className="w-[11rem]">Action</Th>
                  <Th className="w-[9rem]">Entity</Th>
                  <Th>Subject</Th>
                  <Th className="w-[6rem]">Detail</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const open = expanded === entry.id;
                  const hasDetail = Boolean(entry.oldValue || entry.newValue);

                  return (
                    <React.Fragment key={entry.id}>
                      <tr className="border-t align-top" style={{ borderColor: "var(--line)" }}>
                        <Td className="whitespace-nowrap text-[11.5px]">
                          {formatBusinessTimestamp(entry.createdAt)}
                        </Td>
                        <Td>
                          <UserChip name={entry.actorName} color={entry.actorColor} />
                          {entry.impersonatedName ? (
                            <span
                              className="mt-0.5 block text-[10.5px]"
                              style={{ color: "var(--warn)" }}
                              title="Taken while viewing as this person"
                            >
                              as {entry.impersonatedName}
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          <Badge tone={ACTION_TONE[entry.action] ?? "neutral"}>
                            {entry.action.replace(/_/g, " ")}
                          </Badge>
                        </Td>
                        <Td className="text-[11.5px]" >
                          <Muted>{entry.entityType.replace(/_/g, " ")}</Muted>
                        </Td>
                        <Td className="text-[12px]">
                          {entry.subject ?? <Muted>—</Muted>}
                        </Td>
                        <Td>
                          {hasDetail ? (
                            <button
                              type="button"
                              onClick={() => setExpanded(open ? null : entry.id)}
                              className="text-[11.5px] underline-offset-2 hover:underline"
                              style={{ color: "var(--accent)" }}
                            >
                              {open ? "Hide" : "Show"}
                            </button>
                          ) : (
                            <Muted>—</Muted>
                          )}
                        </Td>
                      </tr>

                      {open ? (
                        <tr style={{ background: "var(--canvas)" }}>
                          <td colSpan={6} className="px-5 py-3">
                            <div className="grid gap-3 md:grid-cols-2">
                              <DetailBlock label="Before" value={entry.oldValue} />
                              <DetailBlock label="After" value={entry.newValue} />
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {cursor ? (
            <div className="flex justify-center border-t px-5 py-3" style={{ borderColor: "var(--line)" }}>
              <Button size="sm" loading={loading} onClick={() => void load(true, cursor)}>
                Load older entries
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function DetailBlock({ label, value }: { label: string; value: unknown }) {
  if (!value) {
    return (
      <div>
        <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-subtle)" }}>
          {label}
        </p>
        <Muted>—</Muted>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink-subtle)" }}>
        {label}
      </p>
      <pre
        className="overflow-x-auto rounded border px-2 py-1.5 font-mono text-[11px] scrollbar-thin"
        style={{ borderColor: "var(--line)", background: "var(--surface)" }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
