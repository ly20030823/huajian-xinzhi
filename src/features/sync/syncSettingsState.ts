import type { GitSyncStatus } from "./types";

export function assertSyncStatus(
  status: GitSyncStatus | null | undefined,
): asserts status is GitSyncStatus {
  if (
    !status ||
    !status.settings ||
    typeof status.settings.enabled !== "boolean" ||
    typeof status.settings.repositoryUrl !== "string" ||
    typeof status.settings.branch !== "string" ||
    typeof status.settings.workspaceName !== "string" ||
    typeof status.settings.autoSync !== "boolean" ||
    typeof status.settings.intervalMinutes !== "number"
  ) {
    throw new Error("同步设置保存后返回了无效状态，请重新打开设置后再试");
  }
}
