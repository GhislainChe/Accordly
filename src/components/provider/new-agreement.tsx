"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Organization } from "@/features/agreements/types";
import { AgreementComposer } from "@/components/composer/agreement-composer";
import { StudioHeader } from "@/components/composer/studio-header";
import { Notice } from "@/components/ui/primitives";
import { request, useAction, useIdempotency } from "@/lib/ui/api";
export function NewAgreement({ organizations, initialOrganization }: { organizations: Organization[]; initialOrganization?: string | null }) {
  const eligible = organizations.filter((o) => o.status === "active" && ["owner", "admin", "editor"].includes(o.role));
  const [org, setOrg] = useState(eligible.find((o) => o.id === initialOrganization)?.id ?? eligible[0]?.id ?? ""), action = useAction(), idempotent = useIdempotency(), router = useRouter();
  return <><StudioHeader /><Link href="/app" className="studio-back">← Back to workspace</Link>{action.error && <Notice error>{action.error}</Notice>}{eligible.length ? <AgreementComposer create busy={action.busy} introduction={<div className="studio-workspace"><label htmlFor="organization">Provider workspace<select id="organization" disabled={action.busy} value={org} onChange={e => setOrg(e.target.value)}>{eligible.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label><p className="studio-hint">Save here first. You’ll then enter the designated parties before freezing.</p></div>} onSave={async (draft, title) => (await action.run(async () => { const result = await request<{ agreement_id: string }>("/api/agreements/commands", idempotent({ operation: "create_draft", resource_id: org, input: { title, draft } })); router.push(`/app/agreements/${result.agreement_id}`); router.refresh(); return true; })) === true} /> : <Notice error>No active organization permits you to create an agreement. Ask your organization owner to provision access.</Notice>}</>;
}
