import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { listAuditActions, listAuditLog } from "@/lib/services/audit-log";
import { listSelectableUsers } from "@/lib/services/users";
import { canAssignOthers } from "@/lib/domain/constants";
import { AuditLogView } from "@/components/audit/audit-log-view";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");
  // Manager and above: the log shows who did what across every event.
  if (!canAssignOthers(actor.effective.role)) redirect("/dashboard");

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
