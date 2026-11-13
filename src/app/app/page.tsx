import { providerWorkspace } from "@/features/agreements/provider";
import { Dashboard } from "@/components/provider/dashboard";
export default async function WorkspacePage() { return <Dashboard data={await providerWorkspace()} />; }
