export function escapeEditorSearchTerm(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
