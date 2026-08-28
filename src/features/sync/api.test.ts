import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { downloadSyncWorkspace } from "./api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("sync api", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  test("downloads a workspace through the read-only Rust command", async () => {
    mockedInvoke.mockResolvedValue({ downloaded: 10, uploaded: 0 });

    await expect(downloadSyncWorkspace()).resolves.toEqual({
      downloaded: 10,
      uploaded: 0,
    });
    expect(mockedInvoke).toHaveBeenCalledWith("sync_download");
  });
});
