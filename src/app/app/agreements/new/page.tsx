import { providerWorkspace } from "@/features/agreements/provider";
import { NewAgreement } from "@/components/provider/new-agreement";
export default async function NewPage() { const data = await providerWorkspace(); return <NewAgreement organizations={data.organizations} initialOrganization={data.selected_organization_id} />; }
