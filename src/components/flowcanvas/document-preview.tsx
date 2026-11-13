import type { AgreementRow } from "@/features/agreements/types";
import { Status } from "@/components/ui/primitives";
import { lifecycleLabels } from "./presentation";
import { FlowIcon } from "./icons";
export function DocumentPreview({ agreement, selected, counterparty, onSelect, buttonRef }: { agreement: AgreementRow; selected: boolean; counterparty?: string; onSelect: () => void; buttonRef?: (node: HTMLButtonElement | null) => void }) {
  return <button ref={buttonRef} className="flow-document" aria-label={`Preview ${agreement.title}, ${lifecycleLabels[agreement.lifecycle]}${counterparty ? `, client ${counterparty}` : ""}`} aria-pressed={selected} aria-controls={selected ? "flow-detail-panel" : undefined} onClick={onSelect}>
    <span className="flow-document-artifact" aria-hidden="true"><span className="flow-paper-top"><FlowIcon kind="document" />{selected && <FlowIcon kind="selected" />}</span><span className="flow-document-page"><span className="flow-paper-rules"><span /><span /><span /><span /><span /></span><span className="flow-paper-marker" /></span></span>
    <span className="flow-paper-title">{agreement.title}</span><span className="flow-paper-caption"><span>{counterparty || "Participants in details"}</span><Status value={agreement.lifecycle} /></span>
  </button>;
}

