import { describe, expect, test } from "vitest";
import {
  prepareMarkdownForContentEditor,
  restoreMarkdownFromContentEditor,
} from "./contentEditorMarkdown";

describe("content editor Markdown compatibility", () => {
  test("protects a LaTeX subscript from MDX tag parsing and restores it on save", () => {
    const source = String.raw`S=\beta[-\log P(O_t\mid O_{<t})]`;
    const prepared = prepareMarkdownForContentEditor(source);

    expect(prepared).toBe(String.raw`S=\beta[-\log P(O_t\mid O\_{\<t})]`);
    expect(restoreMarkdownFromContentEditor(prepared)).toBe(source);
  });

  test("does not rewrite examples inside fenced code blocks", () => {
    const source = ["```text", "O_{<t}", "```", "outside O_{<t}"].join("\n");
    const prepared = prepareMarkdownForContentEditor(source);

    expect(prepared).toBe(["```text", "O_{<t}", "```", String.raw`outside O\_{\<t}`].join("\n"));
    expect(restoreMarkdownFromContentEditor(prepared)).toBe(source);
  });

  test("leaves intentional escaped comparison characters unchanged", () => {
    const source = String.raw`literal \<tag and x < y`;
    expect(restoreMarkdownFromContentEditor(prepareMarkdownForContentEditor(source))).toBe(source);
  });
});
