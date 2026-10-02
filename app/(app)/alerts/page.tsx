import { requirePageActor } from "@/lib/auth/guards";
import { prisma } from "@/lib/db/prisma";
import { isPushConfigured } from "@/lib/services/push";
import { PUSH_CATEGORIES } from "@/lib/domain/push-categories";
import { AlertsView } from "@/components/alerts/alerts-view";

export const dynamic = "force-dynamic";

/**
 * Flags and mentions, as a page.
 *
 * The list itself is loaded client-side from an endpoint that takes no
 * recipient, so there is no request shape that asks for somebody else's — which
 * is why this page has no permission gate on the notifications themselves.
 *
 * The preferences are read here rather than fetched, so the switches render in
 * the position they are actually in instead of flicking across on arrival.
 */
export default async function AlertsPage() {
  const actor = await requirePageActor();

  /*
   * Only the categories this person's role may be told about.
   *
   * A switch for something that cannot reach them either way is worse than no
   * switch: it implies they are missing notifications they were never going to
   * get, and turning it on would change nothing.
   */
  const categories = isPushConfigured()
    ? PUSH_CATEGORIES.filter(
        (category) =>
          !category.permission ||
          actor.effective.permissions.has(category.permission),
      )
    : [];

  const me = await prisma.user.findUnique({
    where: { id: actor.effective.id },
    select: { pushMuted: true },
  });

  return <AlertsView pushCategories={categories} pushMuted={me?.pushMuted ?? []} />;
}
