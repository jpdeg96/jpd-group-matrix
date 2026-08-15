import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { HelpView } from "@/components/help/help-view";

export const dynamic = "force-dynamic";

/** Open to everybody signed in — the people most likely to need it have the fewest permissions. */
export default async function HelpPage() {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");

  return <HelpView role={actor.effective.role} />;
}
