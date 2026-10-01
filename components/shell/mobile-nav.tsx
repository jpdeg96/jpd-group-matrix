"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { ThemeToggle } from "@/components/ui/theme";
import { useNotifications } from "./use-notifications";

/**
 * Where a phone can go.
 *
 * Deliberately not the whole application. Settings, Users, the Audit Log and
 * the Payroll sub-screens are desk work — wide tables and long forms that a
 * 390px screen can only make worse — and they stay reachable from the More
 * sheet rather than being promoted to a thumb-sized tab.
 *
 * Each entry names the permission that opens it, exactly as the top nav does,
 * so a role change moves the tab bar and the routes together.
 */
const TABS = [
  { href: "/dashboard", label: "Events", icon: "📋" },
  { href: "/c1", label: "C1", icon: "✅" },
  { href: "/alerts", label: "Alerts", icon: "🔔" },
  { href: "/team", label: "Team", icon: "👥", permission: "presence.viewTeam" },
  { href: "/metrics", label: "Metrics", icon: "📊" },
  { href: "/payroll/approvals", label: "Payroll", icon: "💷", permission: "payroll.approve" },
] as const;

/** Everything that did not fit, behind one more. */
const OVERFLOW = [
  { href: "/payroll", label: "Payroll dashboard", permission: "payroll.view" },
  { href: "/payroll/invoices", label: "Invoices", permission: "payroll.view" },
  { href: "/payroll/time", label: "Imported time", permission: "payroll.view" },
  { href: "/audit", label: "Audit log", permission: "audit.view" },
  { href: "/users", label: "Users & roles", permission: "users.manage" },
  { href: "/settings", label: "Settings", permission: "settings.manage" },
  { href: "/help", label: "Guide" },
] as const;

/**
 * How many tabs fit across a phone before they stop being tappable.
 *
 * Five plus More. At 375px — the narrowest phone still in use — that is six
 * targets of 62px, comfortably past the 44px minimum and still wide enough
 * for "Metrics" at 10.5px without truncating.
 *
 * Five rather than four because a manager has six candidates, and at four the
 * one that spilled was Metrics: a screen people check daily, demoted below a
 * payroll run they open once a week.
 */
const MAX_TABS = 5;

/**
 * The phone navigation.
 *
 * A bottom bar rather than a hamburger: the five things people open this on a
 * phone for are all one tap from each other, and the bar sits where a thumb
 * already is. The desktop header keeps its own tab row — this replaces it
 * below `md` rather than existing alongside it.
 */
export function MobileNav({ permissions }: { permissions: readonly string[] }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);

  // The bell count, so Alerts carries its badge without opening the tab.
  const { unread } = useNotifications();

  const held = React.useMemo(() => new Set(permissions), [permissions]);
  const allowed = TABS.filter(
    (tab) => !("permission" in tab) || held.has(tab.permission),
  );
  const overflow = OVERFLOW.filter(
    (item) => !("permission" in item) || held.has(item.permission),
  );

  /*
   * Anything past the fourth tab moves into More rather than being dropped.
   *
   * Which tabs a person gets depends on their role, so this cannot be a fixed
   * list: an administrator has six candidates and a base user three. Taking
   * the first four in declared order keeps Events and C1 — the two screens
   * this exists for — in the same place for everybody.
   */
  const tabs = allowed.slice(0, MAX_TABS);
  const spilled = allowed.slice(MAX_TABS);
  const moreItems = [...spilled.map((tab) => ({ href: tab.href, label: tab.label })), ...overflow];

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const moreActive = moreItems.some((item) => isActive(item.href));

  React.useEffect(() => {
    // Any navigation closes the sheet, including a back gesture.
    setMoreOpen(false);
  }, [pathname]);

  return (
    <>
      {moreOpen ? (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ background: "color-mix(in oklch, var(--ink) 35%, transparent)" }}
          onClick={() => setMoreOpen(false)}
          aria-hidden
        />
      ) : null}

      {moreOpen ? (
        <div
          role="dialog"
          aria-label="More"
          className="fixed inset-x-0 z-50 max-h-[60vh] overflow-y-auto rounded-t-2xl border-t p-2 shadow-2xl md:hidden"
          style={{
            // Sits directly on top of the bar, not behind it.
            bottom: "calc(3.75rem + env(safe-area-inset-bottom))",
            background: "var(--surface-raised)",
            borderColor: "var(--line-strong)",
          }}
        >
          {moreItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-3 py-3 text-[14px] font-medium"
              style={{
                background: isActive(item.href) ? "var(--accent-soft)" : "transparent",
                color: isActive(item.href) ? "var(--accent)" : "var(--ink)",
              }}
            >
              {item.label}
            </Link>
          ))}

          <div
            className="mt-1 flex items-center justify-between gap-2 border-t px-3 pt-3 pb-1"
            style={{ borderColor: "var(--line)" }}
          >
            <ThemeToggle />
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/sign-in" })}
              className="rounded-md border px-3 py-2 text-[13px] font-medium"
              style={{ borderColor: "var(--line-strong)", color: "var(--ink-muted)" }}
            >
              Sign out
            </button>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-50 grid border-t md:hidden"
        style={{
          gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))`,
          background: "var(--surface)",
          borderColor: "var(--line-strong)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          const badge = tab.href === "/alerts" && unread > 0 ? unread : 0;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className="relative flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 px-1"
              style={{ color: active ? "var(--accent)" : "var(--ink-subtle)" }}
            >
              <span aria-hidden className="text-[17px] leading-none">
                {tab.icon}
              </span>
              <span className="text-[10.5px] font-medium leading-none">{tab.label}</span>

              {badge > 0 ? (
                <span
                  className="absolute top-2 right-[22%] min-w-[1rem] rounded-full px-1 text-[9.5px] font-bold tabular-nums leading-4"
                  style={{ background: "var(--danger)", color: "var(--accent-contrast)" }}
                >
                  {badge > 9 ? "9+" : badge}
                </span>
              ) : null}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setMoreOpen((value) => !value)}
          aria-expanded={moreOpen}
          className="flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 px-1"
          style={{ color: moreOpen || moreActive ? "var(--accent)" : "var(--ink-subtle)" }}
        >
          <span aria-hidden className="text-[17px] leading-none">
            ☰
          </span>
          <span className="text-[10.5px] font-medium leading-none">More</span>
        </button>
      </nav>
    </>
  );
}
