import { beforeEach, describe, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getCustomizationContent } from "./api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("customization API", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  test("loads customization Markdown through the desktop backend", async () => {
    const content = {
      greetingsMarkdown: "- 你好",
      aboutMarkdown: "# 花笺",
      directory: "C:\\FloralNotepaper\\customization",
    };
    vi.mocked(invoke).mockResolvedValue(content);

    await expect(getCustomizationContent()).resolves.toEqual(content);
    expect(invoke).toHaveBeenCalledWith("customization_get");
  });
});
