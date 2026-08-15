import { redirect } from "next/navigation";
import { getActorContext } from "@/lib/auth/guards";
import { listContractors, listSeedableUsers } from "@/lib/services/contractors";
import { ContractorsView } from "@/components/payroll/contractors-view";

export const dynamic = "force-dynamic";

/** Administrator-only: rates decide what people are paid. */
export default async function ContractorsPage() {
  const actor = await getActorContext();
  if (!actor) redirect("/sign-in");
  if (actor.effective.role !== "ADMIN") redirect("/payroll");

  const [contractors, seedable] = await Promise.all([
    listContractors({ includeInactive: true }),
    listSeedableUsers(),
  ]);

  return (
    <ContractorsView
      contractors={contractors.map((contractor) => ({
        id: contractor.id,
        name: contractor.name,
        payType: contractor.payType,
        weeklyAmount: contractor.weeklyAmount?.toFixed(2) ?? null,
        hourlyRate: contractor.hourlyRate?.toFixed(4) ?? null,
        invoicePrefix: contractor.invoicePrefix,
        active: contractor.active,
        remittanceEmail: contractor.remittanceEmail,
        clockifyUserId: contractor.clockifyUserId,
        linkedUserName: contractor.user?.displayName ?? null,
        invoiceCount: contractor._count.invoices,
        notes: contractor.notes,
      }))}
      seedable={seedable}
    />
  );
}
