import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { listUsers } from "@/lib/services/users";
import { listClockifyUsers } from "@/lib/services/clockify";
import { isGoogleAuthEnabled } from "@/lib/auth";
import { UsersView } from "@/components/users/users-view";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");
  if (actor.effective.role !== "ADMIN") redirect("/dashboard");

  // Clockify members are fetched so the mapping can be a dropdown. If the
  // integration is off or unreachable this is empty and the form falls back to
  // a plain id field, rather than blocking user management on a third party.
  const [users, clockifyUsers] = await Promise.all([
    listUsers(),
    listClockifyUsers(),
  ]);

  return (
    <UsersView
      users={users}
      clockifyUsers={clockifyUsers}
      currentUserId={actor.real.id}
      googleEnabled={isGoogleAuthEnabled}
    />
  );
}
