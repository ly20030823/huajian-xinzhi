import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

describe("MarkdownPreview", () => {
  test("marks rendered Markdown content as selectable", () => {
    const markup = renderToStaticMarkup(<MarkdownPreview content="# 花笺\n\n正文" />);

    expect(markup).toContain("markdown-selectable");
    expect(markup).toContain("<h1");
    expect(markup).toContain("花笺");
    expect(markup).toContain("正文");
  });

  test("keeps code block controls outside the horizontally scrollable pre", () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content={"```text\nvery long code line\n```"} />,
    );

    const preOpenIndex = markup.indexOf("<pre");
    const preCloseIndex = markup.indexOf("</pre>");
    const buttonIndex = markup.indexOf("<button");

    expect(markup).toContain("markdown-code-block");
    expect(markup).toContain("markdown-code-scroll");
    expect(preCloseIndex).toBeGreaterThan(-1);
    expect(buttonIndex < preOpenIndex || buttonIndex > preCloseIndex).toBe(true);
  });

  test("recognizes Mermaid fences as diagrams instead of ordinary code blocks", () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content={"```mermaid\nflowchart LR\n  A --> B\n```"} />,
    );

    expect(markup).toContain("mermaid-preview-card");
    expect(markup).toContain("正在绘制流程图");
    expect(markup).not.toContain("markdown-code-scroll");
  });

  test("renders tables with the adaptive striped table shell", () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview
        content={"| 等级 | 说明 |\n| --- | --- |\n| L1 | 短内容 |\n| L2 | 可以自动换行的较长内容 |"}
      />,
    );

    expect(markup).toContain("markdown-table-scroll");
    expect(markup).toContain("markdown-rendered-table");
    expect(markup).toContain("markdown-rendered-table__header");
    expect(markup).toContain("markdown-rendered-table__cell");
  });

  test("keeps every heading level bold", () => {
    const markup = renderToStaticMarkup(
      <MarkdownPreview content={"# 一级\n\n#### 四级\n\n##### 五级\n\n###### 六级"} />,
    );

    expect(markup.match(/font-bold/g)).toHaveLength(4);
    expect(markup).toContain("<h5");
    expect(markup).toContain("<h6");
  });
});
