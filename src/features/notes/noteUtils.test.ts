import { describe, expect, it } from "vitest";
import {
  buildPreview,
  countNoteChars,
  filterNotes,
  getDisplayTitle,
  groupNotesByCategory,
  markdownToPlainText,
} from "./noteUtils";
import type { NoteMetadata } from "./types";

const notes: NoteMetadata[] = [
  {
    id: "1",
    title: "读书笔记",
    fileName: "1.md",
    category: "",
    createdAt: "2026-04-28T01:00:00Z",
    updatedAt: "2026-04-28T01:00:00Z",
    wordCount: 20,
    preview: "关于月亮与六便士",
  },
  {
    id: "2",
    title: "",
    fileName: "2.md",
    category: "日常",
    createdAt: "2026-04-28T02:00:00Z",
    updatedAt: "2026-04-28T02:00:00Z",
    wordCount: 12,
    preview: "周末采购清单",
  },
];

describe("note utilities", () => {
  it("uses title, preview, then untitled fallback for display title", () => {
    expect(getDisplayTitle(notes[0])).toBe("读书笔记");
    expect(getDisplayTitle(notes[1])).toBe("周末采购清单");
    expect(getDisplayTitle({ ...notes[1], preview: "" })).toBe("无标题笔记");
  });

  it("builds compact previews and counts non-whitespace characters", () => {
    const content = "# 标题\n\n正文 第一行\n第二行";

    expect(buildPreview(content)).toBe("标题 正文 第一行 第二行");
    expect(countNoteChars(content)).toBe(11);
  });

  it("turns Markdown source into a readable list preview", () => {
    const content = `---\ntags: [demo]\n---\n## 周末计划\n- [x] **买花**\n- 看[展览](https://example.com)\n\n| 天气 | 心情 |\n| --- | --- |\n| 晴 | 很好 |`;

    expect(markdownToPlainText(content)).toBe("周末计划 买花 看展览 天气 心情 晴 很好");
  });

  it("filters notes by title, preview, or file name without case sensitivity", () => {
    expect(filterNotes(notes, "读书").map((note) => note.id)).toEqual(["1"]);
    expect(filterNotes(notes, "采购").map((note) => note.id)).toEqual(["2"]);
    expect(filterNotes(notes, "2.MD").map((note) => note.id)).toEqual(["2"]);
    expect(filterNotes(notes, "   ").map((note) => note.id)).toEqual(["1", "2"]);
  });

  it("includes empty categories from allCategories list", () => {
    const groups = groupNotesByCategory(notes, ["日常", "工作"]);
    const categoryNames = groups.map((g) => g.category);
    expect(categoryNames).toContain("工作");
    const workGroup = groups.find((g) => g.category === "工作");
    expect(workGroup?.notes).toEqual([]);
  });

  it("keeps the requested folder order", () => {
    const groups = groupNotesByCategory(notes, ["工作", "日常", ""]);
    expect(groups.map((group) => group.category)).toEqual(["工作", "日常", ""]);
  });

  it("keeps the requested note order inside a folder", () => {
    const sameFolder = notes.map((note) => ({ ...note, category: "日常" }));
    const groups = groupNotesByCategory(sameFolder, ["日常"], ["1", "2"]);
    expect(groups[0]?.notes.map((note) => note.id)).toEqual(["1", "2"]);
  });
});
