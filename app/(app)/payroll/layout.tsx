import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { canAssignOthers } from "@/lib/domain/constants";
import { PayrollNav } from "@/components/payroll/payroll-nav";

export const dynamic = "force-dynamic";

/**
 * Payroll shell.
 *
 * Gated at manager and above as a whole, with the individual actions gated
 * further inside: a manager reviews and approves weeks, but only an
 * administrator imports time, generates invoices or records payments. Those
 * checks live on the routes as well, so the sub-navigation is a convenience
 * rather than the control.
 */
export default async function PayrollLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");
  if (!canAssignOthers(actor.effective.role)) redirect("/dashboard");

  return (
    <div className="space-y-4">
      <PayrollNav isAdmin={actor.effective.role === "ADMIN"} />
      {children}
    </div>
  );
}
