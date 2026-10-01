"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { ThemeToggle } from "@/components/ui/theme";
import { ClockifyWidget } from "./clockify-widget";
import { TeamPresenceWidget } from "./team-presence-widget";
import { NotificationBell } from "./notification-bell";
import { Logo } from "./logo";
import { UserChip } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiRequestError } from "@/lib/ui/api-client";
import { cn } from "@/lib/ui/cn";


interface NavUser {
  id: string;
  displayName: string;
  color: string;
  /** A role key — the three built-ins, or a custom role's own. */
  role: string;
  /** What the role is called on screen. */
  roleName: string;
  /** Resolved grants, so the nav offers exactly what the routes will allow. */
  permissions: readonly string[];
}

/**
 * Each tab names the permission that opens it, so the nav and the routes
 * cannot drift: unticking a box in the role editor removes the tab *and*
 * closes the route, rather than hiding a door that is still unlocked.
 */
const NAV_ITEMS = [
  { href: "/dashboard", label: "Event Dashboard" },
  { href: "/c1", label: "C1" },
  // Everyone: a regular user sees only their own figures, which the page and
  // the API both scope from the session rather than from the request.
  { href: "/metrics", label: "Metrics" },
  { href: "/payroll", label: "Payroll", permission: "payroll.view" },
  { href: "/audit", label: "Audit Log", permission: "audit.view" },
  { href: "/users", label: "Users", permission: "users.manage" },
  { href: "/settings", label: "Settings", permission: "settings.manage" },
] as const;

export function AppNav({
  user,
  realUser,
  isImpersonating,
  impersonationTargets,
  siteName,
  logoSrc,
  businessDate,
  timeZoneLabel,
}: {
  user: NavUser;
  realUser: NavUser;
  isImpersonating: boolean;
  impersonationTargets: Array<{ id: string; displayName: string; color: string; roleName: string }>;
  siteName: string;
  /** Resolved server-side so a missing PNG never 404s in the browser. */
  logoSrc: string;
  businessDate: string;
  timeZoneLabel: string;
}) {
  const pathname = usePathname();

  // Nav visibility follows the *effective* user, so viewing as somebody else
  // genuinely shows their application rather than your own.
  const held = React.useMemo(() => new Set(user.permissions), [user.permissions]);

  const navItems = NAV_ITEMS.filter(
    (item) => !("permission" in item) || held.has(item.permission),
  );

  return (
    <header
      className="sticky top-0 z-40 border-b backdrop-blur"
      style={{ borderColor: "var(--line)", background: "color-mix(in oklch, var(--surface) 92%, transparent)" }}
    >
      <div className="mx-auto flex w-full max-w-[1800px] items-center gap-3 px-3 py-2 lg:px-6">
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center gap-2 whitespace-nowrap"
          title={siteName}
        >
          <Logo src={logoSrc} height={48} alt={siteName} />
        </Link>

        <nav className="hidden items-center gap-0.5 overflow-x-auto md:flex">
          {navItems.map(
            (item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12.5px] font-medium transition"
                  style={{
                    background: active ? "var(--accent-soft)" : "transparent",
                    color: active ? "var(--accent)" : "var(--ink-muted)",
                  }}
                >
                  {item.label}
                </Link>
              );
            },
          )}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {/* The business date is shown permanently: every deadline and urgency
              badge on screen is computed against this date, not the viewer's
              own clock. */}
          <div
            className="hidden text-right leading-tight md:block"
            title={`All dates use ${timeZoneLabel}`}
          >
            <div className="text-[11.5px] font-medium">{businessDate}</div>
            <div className="text-[10.5px]" style={{ color: "var(--ink-subtle)" }}>
              {timeZoneLabel}
            </div>
          </div>

          <span className="hidden md:inline-flex">
            <NotificationBell />
          </span>

          {/* Managers and above only — the endpoint enforces the same rule. */}
          {held.has("presence.viewTeam") ? (
            <span className="hidden md:inline-flex">
              <TeamPresenceWidget />
            </span>
          ) : null}

          <span className="hidden md:inline-flex">
            <ClockifyWidget />
          </span>

          {/* In the header rather than the tab row: the tab row is already
              seven items, and help is something you reach for occasionally
              rather than a place you work. */}
          <Link
            href="/help"
            aria-label="Guide"
            title="How the site works"
            className="hidden rounded-md border px-2 py-1 text-[11.5px] font-medium transition md:inline-block"
            style={{
              borderColor: pathname === "/help" ? "transparent" : "var(--line-strong)",
              background: pathname === "/help" ? "var(--accent-soft)" : "transparent",
              color: pathname === "/help" ? "var(--accent)" : "var(--ink-muted)",
            }}
          >
            Guide
          </Link>

          <ThemeToggle className="hidden sm:inline-flex" />

          {realUser.permissions.includes("impersonate") && !isImpersonating ? (
            <ViewAsMenu targets={impersonationTargets} />
          ) : null}

          <div className="text-right leading-tight">
            <div className="text-[11.5px] font-medium">
              <UserChip name={user.displayName} color={user.color} />
            </div>
            <div className="text-[10.5px]" style={{ color: "var(--ink-subtle)" }}>
              {user.roleName}
            </div>
          </div>

          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/sign-in" })}
            className="hidden rounded-md border px-2 py-1 text-[11.5px] transition md:inline-block"
            style={{ borderColor: "var(--line-strong)", color: "var(--ink-muted)" }}
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

/** Administrator-only picker for "view as another user". */
function ViewAsMenu({
  targets,
}: {
  targets: Array<{ id: string; displayName: string; color: string; roleName: string }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const onClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function start(userId: string) {
    setPending(true);
    try {
      await api.post("/api/impersonate", { userId });
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(
        "Could not start viewing as that user.",
        error instanceof ApiRequestError ? error.message : undefined,
      );
    } finally {
      setPending(false);
    }
  }

  if (targets.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="View the application as another user"
        className="rounded-md border px-2 py-1 text-[11.5px] transition"
        style={{ borderColor: "var(--line-strong)", color: "var(--ink-muted)" }}
      >
        View as…
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 max-h-80 w-60 overflow-y-auto rounded-md border p-1 shadow-xl scrollbar-thin"
          style={{ background: "var(--surface-raised)", borderColor: "var(--line-strong)" }}
        >
          <p
            className="px-2 py-1.5 text-[11px]"
            style={{ color: "var(--ink-subtle)" }}
          >
            Everything you do while viewing as someone is logged against your own
            account.
          </p>
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() => start(target.id)}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12px] transition hover:brightness-95 disabled:opacity-50"
              style={{ background: "transparent" }}
            >
              <UserChip name={target.displayName} color={target.color} />
              <span className="text-[10.5px]" style={{ color: "var(--ink-subtle)" }}>
                {target.roleName}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
