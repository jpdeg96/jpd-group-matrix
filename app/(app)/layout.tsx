import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { AppNav } from "@/components/shell/app-nav";
import { ImpersonationBanner } from "@/components/shell/impersonation-banner";
import { WorkingBanner } from "@/components/shell/working-banner";
import { getSettings } from "@/lib/services/settings";
import { businessToday } from "@/lib/services/settings";
import { formatPlainDateWithWeekday } from "@/lib/date/plain-date";
import { listImpersonationTargets } from "@/lib/services/users";
import { resolveLogoSrc } from "@/lib/ui/logo-path";

export const dynamic = "force-dynamic";

/**
 * Authenticated shell.
 *
 * Route protection lives here rather than in middleware: the session check
 * reaches Prisma for the current role and active flag, which needs the Node.js
 * runtime.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");

  const [settings, today] = await Promise.all([getSettings(), businessToday()]);

  // Only loaded for a real administrator — this list is the impersonation menu.
  const impersonationTargets =
    actor.real.role === "ADMIN" ? await listImpersonationTargets(actor.real.id) : [];

  const zoneLabel = settings.timeZone.split("/").pop()?.replace(/_/g, " ") ?? settings.timeZone;

  return (
    <div className="min-h-screen" style={{ background: "var(--canvas)" }}>
      {actor.isImpersonating ? (
        <ImpersonationBanner
          viewingAs={actor.effective}
          realName={actor.real.displayName}
        />
      ) : null}

      <AppNav
        user={actor.effective}
        realUser={actor.real}
        isImpersonating={actor.isImpersonating}
        impersonationTargets={impersonationTargets}
        siteName={settings.siteName}
        logoSrc={resolveLogoSrc()}
        businessDate={formatPlainDateWithWeekday(today)}
        timeZoneLabel={zoneLabel}
      />

      {/* Directly under the nav so a live claim is visible on every screen,
          not only on the table that made it. */}
      <WorkingBanner />

      <main className="mx-auto w-full max-w-[1800px] px-3 py-4 lg:px-6">
        {children}
      </main>
    </div>
  );
}
