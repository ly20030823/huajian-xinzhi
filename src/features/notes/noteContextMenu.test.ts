import { describe, expect, test } from "vitest";
import { getNoteContextMenuItems } from "./noteContextMenu";

describe("note context menu", () => {
  test("offers a system folder reveal action near the top", () => {
    const translate = ((_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? "") as never;
    const items = getNoteContextMenuItems(translate);

    expect(items[1]).toEqual({
      action: "openInFolder",
      label: "在文件夹中打开",
    });
    expect(items[2]).toEqual({
      action: "copyFilePath",
      label: "复制文件路径",
    });
  });
});
