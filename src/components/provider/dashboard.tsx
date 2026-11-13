import type { Workspace } from "@/features/agreements/types";
import { FlowCanvas } from "@/components/flowcanvas/canvas";
import { selectedWorkspace } from "@/components/flowcanvas/presentation";
export function Dashboard({ data }: { data: Workspace }) {
  return <FlowCanvas data={selectedWorkspace(data)} limited={data.agreements.length >= 200} />;
}
