import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { can } from "@/lib/auth/actor";
import { listUsers } from "@/lib/services/users";
import { listRoles } from "@/lib/services/roles";
import { listClockifyUsers } from "@/lib/services/clockify";
import { isGoogleAuthEnabled } from "@/lib/auth";
import { UsersView } from "@/components/users/users-view";
import { RolesView } from "@/components/users/roles-view";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");
  if (!can(actor, "users.manage")) redirect("/dashboard");

  // Clockify members are fetched so the mapping can be a dropdown. If the
  // integration is off or unreachable this is empty and the form falls back to
  // a plain id field, rather than blocking user management on a third party.
  const [users, roles, clockifyUsers] = await Promise.all([
    listUsers(),
    listRoles(),
    listClockifyUsers(),
  ]);

  return (
    <div className="space-y-4">
      <UsersView
        users={users}
        roles={roles}
        clockifyUsers={clockifyUsers}
        currentUserId={actor.real.id}
        googleEnabled={isGoogleAuthEnabled}
      />

      {/* Below the people rather than above: the list is what this screen is
          opened for day to day, and the matrix is what it is opened for when
          something needs changing. */}
      <RolesView roles={roles} />
    </div>
  );
}
