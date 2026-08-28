import { describe, expect, it } from "vitest";
import { estimateReadingMinutes, extractDocumentHeadings } from "./paperMargin";

describe("paper margin document helpers", () => {
  it("extracts ATX and setext headings while ignoring code fences", () => {
    expect(
      extractDocumentHeadings(`# 标题\n\n## **小节**\n\n~~~md\n# 代码里的标题\n~~~\n\n结尾\n---`),
    ).toEqual([
      { level: 1, text: "标题" },
      { level: 2, text: "小节" },
      { level: 2, text: "结尾" },
    ]);
  });

  it("estimates reading time with a one-minute minimum", () => {
    expect(estimateReadingMinutes(0)).toBe(1);
    expect(estimateReadingMinutes(801)).toBe(3);
  });
});
