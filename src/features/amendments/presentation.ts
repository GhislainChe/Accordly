// Effective is a historical immutable proposal state. Only the root pointer
// identifies the current contract; never rewrite records to change a label.
export function versionPresentation(state: string, versionId: string, effectiveVersionId: string) {
  if (state !== "effective") return state;
  return versionId === effectiveVersionId ? "current_effective" : "historical_effective";
}
