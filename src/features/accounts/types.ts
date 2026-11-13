import type { Organization } from "../agreements/types";
export type AccountStatus = { full_name: string | null; work_kind: "individual" | "business" | null; purpose: "create" | "review" | "both" | null; revision: string; completed: boolean; selected_workspace_id: string | null; workspaces: Organization[]; step: number; next: "/onboarding" | "/workspace-unavailable" | "/app" };
