import { redirect } from "next/navigation";
import { can } from "@hardware/core";
import { PageHeader, ForbiddenState } from "@hardware/ui";
import { getStaffSession } from "../../../../lib/session";
import { PartiesNav } from "../nav";
import { PartyForm } from "../PartyForm";

export default async function NewPartyPage() {
  const session = await getStaffSession();
  if (!session) redirect("/login");

  // The form offers only the kinds this user may actually create; with neither, there
  // is nothing to show.
  const mayCustomers = can(session, "customers.write");
  const maySuppliers = can(session, "suppliers.write");
  if (!mayCustomers && !maySuppliers) {
    return <ForbiddenState perm="customers.write / suppliers.write" />;
  }

  return (
    <div className="space-y-6">
      <PartiesNav active="parties" />
      <PageHeader
        title="Add party"
        description="A customer you sell to, or a supplier you buy from."
      />
      <PartyForm mayCustomers={mayCustomers} maySuppliers={maySuppliers} />
    </div>
  );
}
