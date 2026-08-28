import { describe, expect, test } from "vitest";
import { assertSyncStatus } from "./syncSettingsState";
import type { GitSyncStatus } from "./types";

const validStatus: GitSyncStatus = {
  settings: {
    enabled: true,
    repositoryUrl: "https://github.com/example/notes.git",
    branch: "main",
    autoSync: true,
    intervalMinutes: 5,
    deviceId: "device-1",
    workspaceName: "我的花笺",
  },
  tokenStored: true,
  lastSyncAt: null,
  lastError: "",
};

describe("sync settings response guard", () => {
  test("accepts a complete status returned by the native command", () => {
    expect(() => assertSyncStatus(validStatus)).not.toThrow();
  });

  test.each([
    null,
    undefined,
    {},
    { settings: null },
    { settings: { ...validStatus.settings, enabled: "yes" } },
    { settings: { ...validStatus.settings, repositoryUrl: null } },
    { settings: { ...validStatus.settings, intervalMinutes: "5" } },
  ])("rejects malformed native responses without corrupting React state", (value) => {
    expect(() => assertSyncStatus(value as GitSyncStatus | null | undefined)).toThrow(
      "同步设置保存后返回了无效状态",
    );
  });
});
