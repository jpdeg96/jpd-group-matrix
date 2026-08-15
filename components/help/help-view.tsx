"use client";

import * as React from "react";
import { Badge, Card, PageHeader } from "@/components/ui/primitives";
import {
  AUDIENCE_LABELS,
  HELP_SECTIONS,
  type Audience,
  type HelpSection,
} from "@/lib/domain/help-content";

/**
 * The user guide.
 *
 * Sections above the reader's role are shown rather than hidden, marked with
 * who they apply to. Knowing that an administrator generates the invoices is
 * useful even to somebody who cannot — hiding it just makes the system look
 * arbitrary from below.
 */
export function HelpView({ role }: { role: "ADMIN" | "MANAGER" | "USER" }) {
  const [query, setQuery] = React.useState("");

  const needle = query.trim().toLowerCase();

  const matches = (section: HelpSection): boolean => {
    if (needle === "") return true;
    const haystack = [
      section.title,
      section.summary,
      ...(section.items?.flatMap((item) => [item.term, item.detail]) ?? []),
      ...(section.gotchas ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  };

  const visible = HELP_SECTIONS.filter(matches);

  return (
    <div className="space-y-4">
      <Card>
        <PageHeader
          title="Guide"
          subtitle={
            <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
              What each screen is for, and the handful of behaviours that surprise
              people. Individual fields have their own tooltips — hover anything you
              are unsure about.
            </span>
          }
          actions={
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the guide"
              aria-label="Search the guide"
              className="rounded-md border px-2.5 py-1 text-[12.5px]"
              style={{ borderColor: "var(--line-strong)", background: "var(--surface)" }}
            />
          }
        />

        {needle === "" ? (
          <nav className="flex flex-wrap gap-1.5 px-5 py-3">
            {HELP_SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-md border px-2 py-1 text-[11.5px] font-medium transition"
                style={{ borderColor: "var(--line-strong)", color: "var(--ink-muted)" }}
              >
                {section.title}
              </a>
            ))}
          </nav>
        ) : null}
      </Card>

      {visible.length === 0 ? (
        <Card>
          <p className="px-5 py-8 text-center text-[12.5px]" style={{ color: "var(--ink-subtle)" }}>
            Nothing in the guide matches “{query}”.
          </p>
        </Card>
      ) : (
        visible.map((section) => (
          <Section key={section.id} section={section} role={role} />
        ))
      )}
    </div>
  );
}

function Section({
  section,
  role,
}: {
  section: HelpSection;
  role: "ADMIN" | "MANAGER" | "USER";
}) {
  const applies = canDo(role, section.audience);

  return (
    <Card>
      {/* scroll-mt clears the sticky header when jumping from the contents. */}
      <div id={section.id} className="scroll-mt-20">
        <PageHeader
          title={section.title}
          subtitle={
            <div className="flex flex-wrap items-center gap-2">
              {section.audience !== "everyone" ? (
                <Badge tone={applies ? undefined : "warn"}>
                  {AUDIENCE_LABELS[section.audience]}
                </Badge>
              ) : null}
              <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                {section.summary}
              </span>
            </div>
          }
        />

        <div className="space-y-4 px-5 py-4">
          {section.items ? (
            <dl className="space-y-2.5">
              {section.items.map((item) => (
                <div key={item.term} className="grid gap-1 sm:grid-cols-[11rem_1fr] sm:gap-3">
                  <dt className="text-[12.5px] font-semibold">{item.term}</dt>
                  <dd className="text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
                    {item.detail}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {section.gotchas && section.gotchas.length > 0 ? (
            <div
              className="rounded-md border px-3 py-2.5"
              style={{ borderColor: "var(--line)", background: "var(--canvas)" }}
            >
              <p
                className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide"
                style={{ color: "var(--ink-subtle)" }}
              >
                Worth knowing
              </p>
              <ul className="space-y-1.5">
                {section.gotchas.map((gotcha) => (
                  <li key={gotcha} className="flex gap-2 text-[12.5px]">
                    <span aria-hidden style={{ color: "var(--accent)" }}>
                      •
                    </span>
                    <span style={{ color: "var(--ink-muted)" }}>{gotcha}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function canDo(role: "ADMIN" | "MANAGER" | "USER", audience: Audience): boolean {
  if (audience === "everyone") return true;
  if (audience === "manager") return role === "MANAGER" || role === "ADMIN";
  return role === "ADMIN";
}
