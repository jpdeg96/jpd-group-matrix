import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { PayrollNav } from "@/components/payroll/payroll-nav";
import { can } from "@/lib/auth/actor";

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
  if (!can(actor, "payroll.view")) redirect("/dashboard");

  return (
    <div className="space-y-4">
      <PayrollNav canManageContractors={can(actor, "payroll.manageContractors")} />
      {children}
    </div>
  );
}
