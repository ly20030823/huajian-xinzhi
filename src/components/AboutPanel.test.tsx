import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AboutPanel } from "./AboutPanel";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("1.0.4")),
}));

describe("AboutPanel", () => {
  test("renders the customizable introduction and playful card", () => {
    const markup = renderToStaticMarkup(<AboutPanel onClose={vi.fn()} />);

    expect(markup).toContain("关于");
    expect(markup).toContain("花笺");
    expect(markup).toContain('data-testid="about-custom-markdown"');
    expect(markup).toContain('data-testid="about-mischief-button"');
    expect(markup).toContain('data-testid="open-sync-guide"');
    expect(markup).toContain("Markdown 多设备同步指南");
    expect(markup).toContain("花笺悄悄话");
    expect(markup).toContain("换一句");
  });

  test("does not render update, project link, or contributor sections", () => {
    const markup = renderToStaticMarkup(<AboutPanel onClose={vi.fn()} />);

    expect(markup).not.toContain("检查更新");
    expect(markup).not.toContain("GitHub");
    expect(markup).not.toContain("反馈问题");
    expect(markup).not.toContain("贡献者");
  });
});
