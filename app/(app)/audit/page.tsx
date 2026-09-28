import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { listAuditActions, listAuditLog } from "@/lib/services/audit-log";
import { listSelectableUsers } from "@/lib/services/users";
import { AuditLogView } from "@/components/audit/audit-log-view";
import { can } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");
  // Manager and above: the log shows who did what across every event.
  if (!can(actor, "audit.view")) redirect("/dashboard");

  const [log, actions, users] = await Promise.all([
    listAuditLog({ limit: 100 }),
    listAuditActions(),
    listSelectableUsers(),
  ]);

  return (
    <AuditLogView
      initialEntries={log.entries}
      initialCursor={log.nextCursor}
      actions={actions}
      users={users}
    />
  );
}
