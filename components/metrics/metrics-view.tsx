"use client";

import * as React from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatPill,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/ui/theme";
import { BarChart, type BarDatum } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { ActivityChart } from "@/components/charts/activity-chart";
import {
  categoricalColor,
  SEQUENTIAL_ALT_DARK,
  SEQUENTIAL_ALT_LIGHT,
  SEQUENTIAL_DARK,
  SEQUENTIAL_LIGHT,
} from "@/components/charts/palette";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { cn } from "@/lib/ui/cn";
import { downloadCsv, toCsv } from "@/lib/ui/csv";
import { formatDurationShort } from "@/lib/clockify/duration";
import { formatPlainDate } from "@/lib/date/plain-date";
import {
  METRICS_PERIODS,
  PERIOD_LABELS,
  type MetricsPeriod,
} from "@/lib/domain/metrics-period";
import { roleLabel, type UserRoleValue } from "@/lib/domain/constants";
import type { MetricsResult } from "@/lib/services/metrics";

export function MetricsView({ initial }: { initial: MetricsResult }) {
  const toast = useToast();
  const { theme } = useTheme();
  const [metrics, setMetrics] = React.useState(initial);
  const [period, setPeriod] = React.useState<MetricsPeriod>(initial.period);
  const [loading, setLoading] = React.useState(false);
  const [showTables, setShowTables] = React.useState(false);

  // The chart palette has selected steps per surface; dark is not a flip of
  // light. Blossom is a near-white surface, so it uses the light steps.
  const dark = theme === "dark";

  React.useEffect(() => {
    if (period === metrics.period) return;

    let cancelled = false;
    setLoading(true);

    api
      .get<{ metrics: MetricsResult }>(`/api/metrics?period=${period}`)
      .then((data) => {
        if (!cancelled) setMetrics(data.metrics);
      })
      .catch((error) => {
        if (cancelled) return;
        setPeriod(metrics.period);
        toast.error(
          "Could not load metrics.",
          error instanceof ApiRequestError ? error.message : undefined,
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period, metrics.period, toast]);

  const completionBars: BarDatum[] = metrics.users.map((user) => ({
    key: user.userId,
    label: user.displayName,
    value: user.eventsCompleted,
    dotColor: user.color,
    hint: `${user.stagesDone} C1 stages · ${user.total} actions total`,
  }));

  const stageBars: BarDatum[] = [...metrics.users]
    .sort((a, b) => b.stagesDone - a.stagesDone)
    .map((user) => ({
      key: user.userId,
      label: user.displayName,
      value: user.stagesDone,
      dotColor: user.color,
    }));

  const hourBars: BarDatum[] = metrics.hours.entries.map((entry) => ({
    key: entry.userId,
    label: entry.displayName,
    value: entry.seconds,
    dotColor: entry.color,
  }));

  const donutSlices = metrics.types.map((type) => ({
    key: type.typeId,
    label: `${type.emoji ? `${type.emoji} ` : ""}${type.name}`,
    value: type.count,
    color: categoricalColor(type.slot, dark),
  }));

  function exportCsv() {
    const csv = toCsv(
      [
        "User", "Role", "Active", "Events completed", "C1 stages done",
        "SeatGeek checks", "Audits", "Notes", "Total actions",
      ],
      metrics.users.map((user) => [
        user.displayName,
        roleLabel(user.role as UserRoleValue),
        user.active ? "TRUE" : "FALSE",
        user.eventsCompleted,
        user.stagesDone,
        user.seatGeekChecks,
        user.audits,
        user.notes,
        user.total,
      ]),
    );
    downloadCsv(`user-metrics-${metrics.period.toLowerCase()}-${metrics.to}.csv`, csv);
  }

  // The hours window is not always the period's own range — all-time is capped,
  // because Clockify needs a bounded one. Say which window the bars actually
  // cover rather than let the heading imply a wider one.
  const hoursWindow =
    metrics.hours.from === metrics.hours.to
      ? formatPlainDate(metrics.hours.to)
      : `${formatPlainDate(metrics.hours.from)} – ${formatPlainDate(metrics.hours.to)}`;

  const hoursHint = [
    metrics.hours.capped
      ? `From Clockify, ${hoursWindow} (all-time hours are capped to the last year).`
      : `From Clockify, ${hoursWindow}.`,
    metrics.hours.excludedNames.length > 0
      ? `Excluding ${metrics.hours.excludedNames.join(", ")}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  const rangeLabel = metrics.from
    ? metrics.from === metrics.to
      ? formatPlainDate(metrics.from)
      : `${formatPlainDate(metrics.from)} – ${formatPlainDate(metrics.to)}`
    : `everything up to ${formatPlainDate(metrics.to)}`;

  return (
    <div className="space-y-4" style={{ opacity: loading ? 0.65 : 1 }}>
      <Card>
        <PageHeader
          title="User Metrics"
          subtitle={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <StatPill label="events completed" value={metrics.totals.eventsCompleted} />
              <StatPill label="C1 stages done" value={metrics.totals.stagesDone} />
              <StatPill label="people active" value={metrics.totals.activePeople} />
              <StatPill label="per day" value={metrics.totals.perDay} />
              <span className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
                {rangeLabel}
              </span>
            </div>
          }
          actions={
            <>
              <Button size="sm" onClick={() => setShowTables((value) => !value)}>
                {showTables ? "Hide tables" : "Show tables"}
              </Button>
              <Button size="sm" onClick={exportCsv}>
                Export CSV
              </Button>
            </>
          }
        />

        {/* One filter row above everything it scopes — every chart below
            re-renders against the same slice. */}
        <div
          className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5"
          style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
        >
          <span
            className="text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--ink-subtle)" }}
          >
            Period
          </span>
          {METRICS_PERIODS.map((value) => {
            const active = period === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setPeriod(value)}
                className="rounded-md border px-2.5 py-1 text-[12px] font-medium transition"
                style={{
                  borderColor: active ? "transparent" : "var(--line-strong)",
                  background: active ? "var(--accent)" : "var(--surface)",
                  color: active ? "var(--accent-contrast)" : "var(--ink-muted)",
                }}
              >
                {PERIOD_LABELS[value]}
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Events completed"
          hint="Who ticked Complete on the Event Dashboard."
        >
          <BarChart
            data={completionBars}
            color={dark ? SEQUENTIAL_DARK : SEQUENTIAL_LIGHT}
          />
        </ChartCard>

        <ChartCard
          title="Split by type"
          hint="Share of completed events by event type."
        >
          <DonutChart
            slices={donutSlices}
            centerValue={String(metrics.totals.eventsCompleted)}
            centerLabel="completed"
          />
        </ChartCard>

        <ChartCard
          title="C1 review stages done"
          hint="Individual review checkpoints ticked off in staging."
        >
          <BarChart
            data={stageBars}
            color={dark ? SEQUENTIAL_DARK : SEQUENTIAL_LIGHT}
          />
        </ChartCard>

        <ChartCard
          title={`Hours worked — ${PERIOD_LABELS[metrics.period].toLowerCase()}`}
          hint={hoursHint}
        >
          {!metrics.hours.enabled ? (
            <p className="px-1 py-6 text-center text-[12px]" style={{ color: "var(--ink-subtle)" }}>
              Clockify is switched off in Settings.
            </p>
          ) : metrics.hours.error ? (
            <p className="px-1 py-6 text-center text-[12px]" style={{ color: "var(--danger)" }}>
              {metrics.hours.error}
            </p>
          ) : (
            <BarChart
              data={hourBars}
              color={dark ? SEQUENTIAL_ALT_DARK : SEQUENTIAL_ALT_LIGHT}
              valueFormatter={formatDurationShort}
              emptyMessage="No time logged in this period."
            />
          )}
        </ChartCard>
      </div>

      <Card>
        <PageHeader
          title="Completions per day"
          subtitle={
            <span className="text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
              {metrics.from
                ? "Daily completions across the selected period."
                : "Choose a bounded period to see the daily breakdown."}
            </span>
          }
        />
        <div className="px-5 py-4">
          <ActivityChart
            points={metrics.daily}
            color={dark ? SEQUENTIAL_DARK : SEQUENTIAL_LIGHT}
          />
        </div>
      </Card>

      {/* The table view. Required rather than optional: three palette slots sit
          below 3:1 contrast on a near-white surface, so every value must be
          reachable without relying on colour. */}
      {showTables ? (
        <Card>
          <PageHeader title="All figures" subtitle="The same data, as numbers." />
          {metrics.users.length === 0 ? (
            <EmptyState title="Nobody recorded any activity in this period." />
          ) : (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead style={{ background: "var(--canvas)" }}>
                  <tr>
                    {["User", "Role", "Completed", "Stages", "SeatGeek", "Audits", "Notes", "Total"].map(
                      (label, index) => (
                        <th
                          key={label}
                          className={cn(
                            "px-3 py-2 text-[11px] font-semibold uppercase tracking-wide",
                            index > 1 && "text-right",
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
                  {metrics.users.map((user) => (
                    <tr key={user.userId} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="px-3 py-2 text-[12.5px]">
                        <span className="flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="h-2 w-2 rounded-full"
                            style={{ background: user.color }}
                          />
                          {user.displayName}
                          {!user.active ? <Badge>inactive</Badge> : null}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11.5px]" style={{ color: "var(--ink-muted)" }}>
                        {roleLabel(user.role as UserRoleValue)}
                      </td>
                      {[
                        user.eventsCompleted,
                        user.stagesDone,
                        user.seatGeekChecks,
                        user.audits,
                        user.notes,
                        user.total,
                      ].map((value, index) => (
                        <td
                          key={index}
                          className="px-3 py-2 text-right text-[12.5px] tabular-nums"
                          style={{ fontWeight: index === 5 ? 600 : 400 }}
                        >
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="border-b px-5 py-3" style={{ borderColor: "var(--line)" }}>
        <h2 className="text-[13px] font-semibold">{title}</h2>
        <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink-subtle)" }}>
          {hint}
        </p>
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
  );
}
