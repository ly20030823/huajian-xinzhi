import { describe, expect, it } from "vitest";
import { createEditorTranslation } from "./editorTranslation";

describe("createEditorTranslation", () => {
  it("localizes the visible editor controls in Simplified Chinese", () => {
    const t = createEditorTranslation("zh-CN");

    expect(t("toolbar.blockTypes.paragraph", "Paragraph")).toBe("正文");
    expect(t("toolbar.image", "Insert image")).toBe("插入图片");
    expect(t("uploadImage.dialogTitle", "Upload an image")).toBe("插入图片");
    expect(t("toolbar.blockTypes.heading", "Heading {{level}}", { level: 2 })).toBe("2 级标题");
  });

  it("keeps the editor defaults for English", () => {
    const t = createEditorTranslation("en-US");
    expect(t("toolbar.image", "Insert image")).toBe("Insert image");
  });
});
