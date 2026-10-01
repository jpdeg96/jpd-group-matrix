import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { can } from "@/lib/auth/actor";
import { TeamView } from "@/components/team/team-view";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");

  // The same permission the endpoint behind this page checks. Rendering it
  // for somebody without the grant would show them a page that is permanently
  // empty, which reads as "nobody is working" rather than as "not for you".
  if (!can(actor, "presence.viewTeam")) redirect("/dashboard");

  return <TeamView />;
}
