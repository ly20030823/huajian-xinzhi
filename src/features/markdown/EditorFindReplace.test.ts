import { describe, expect, test } from "vitest";
import { escapeEditorSearchTerm } from "./editorSearch";

describe("escapeEditorSearchTerm", () => {
  test("treats punctuation as literal text instead of a regular expression", () => {
    expect(escapeEditorSearchTerm("a+b (test) [1].md?")).toBe(
      String.raw`a\+b \(test\) \[1\]\.md\?`,
    );
  });

  test("keeps ordinary Chinese text unchanged", () => {
    expect(escapeEditorSearchTerm("查找当前笔记")).toBe("查找当前笔记");
  });
});
