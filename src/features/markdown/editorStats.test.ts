import { describe, expect, test } from "vitest";
import { countSelectedCharacters, getTextEditorSelectionStats } from "./editorStats";

describe("editor statistics", () => {
  test("reports the current source line from the caret", () => {
    const content = "第一行\nsecond\n第三行";
    expect(getTextEditorSelectionStats(content, 10, 10)).toEqual({
      currentLine: 2,
      selectedChars: 0,
    });
  });

  test("counts selected characters without whitespace", () => {
    expect(countSelectedCharacters("你好 world\n!")).toBe(8);
    expect(getTextEditorSelectionStats("one\ntwo words", 4, 13)).toEqual({
      currentLine: 2,
      selectedChars: 8,
    });
  });
});
