"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Card } from "@/components/ui/primitives";

const TABS = [
  { href: "/payroll", label: "Dashboard", exact: true },
  { href: "/payroll/approvals", label: "Weekly approval" },
  { href: "/payroll/invoices", label: "Invoices" },
  { href: "/payroll/time", label: "Imported time" },
  { href: "/payroll/contractors", label: "Contractors", adminOnly: true },
] as const;

/**
 * Sub-navigation within Payroll.
 *
 * Kept out of the top-level nav on purpose: payroll is one job with several
 * screens, and promoting all five would double the width of the main bar for
 * something two people touch once a week.
 */
export function PayrollNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const visible = TABS.filter((tab) => !("adminOnly" in tab && tab.adminOnly) || isAdmin);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-1 px-3 py-2">
        {visible.map((tab) => {
          const active =
            "exact" in tab && tab.exact
              ? pathname === tab.href
              : pathname === tab.href || pathname.startsWith(`${tab.href}/`);

          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className="rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition"
              style={{
                background: active ? "var(--accent-soft)" : "transparent",
                color: active ? "var(--accent)" : "var(--ink-muted)",
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
