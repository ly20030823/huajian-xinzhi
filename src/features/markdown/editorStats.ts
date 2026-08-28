export interface EditorSelectionStats {
  currentLine: number;
  selectedChars: number;
}

export function countSelectedCharacters(value: string): number {
  let count = 0;
  for (const character of value) {
    if (!/\s/.test(character)) count += 1;
  }
  return count;
}

export function getTextEditorSelectionStats(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): EditorSelectionStats {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  return {
    currentLine: value.slice(0, start).split("\n").length,
    selectedChars: countSelectedCharacters(value.slice(start, end)),
  };
}
