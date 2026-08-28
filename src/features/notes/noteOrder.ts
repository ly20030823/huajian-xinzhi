export type NoteDropPosition = "before" | "after";

export function normalizeNoteOrder(order: string[], noteIds: string[]): string[] {
  const available = new Set(noteIds);
  const normalized = order.filter((id, index) => available.has(id) && order.indexOf(id) === index);
  for (const id of noteIds) {
    if (!normalized.includes(id)) normalized.push(id);
  }
  return normalized;
}

export function moveNoteInOrder(
  order: string[],
  noteIds: string[],
  draggedId: string,
  targetId: string,
  position: NoteDropPosition,
): string[] {
  const normalized = normalizeNoteOrder(order, noteIds);
  if (draggedId === targetId || !normalized.includes(draggedId)) return normalized;
  const withoutDragged = normalized.filter((id) => id !== draggedId);
  const targetIndex = withoutDragged.indexOf(targetId);
  if (targetIndex < 0) return normalized;
  withoutDragged.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, draggedId);
  return withoutDragged;
}

export function sortNotesByOrder<T extends { id: string }>(notes: T[], order: string[]): T[] {
  const indexes = new Map(order.map((id, index) => [id, index]));
  return [...notes].sort((left, right) => {
    const leftIndex = indexes.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = indexes.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}
