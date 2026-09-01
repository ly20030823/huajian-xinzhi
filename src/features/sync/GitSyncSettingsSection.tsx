import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  clearSyncToken,
  downloadSyncWorkspace,
  getSyncStatus,
  listSyncWorkspaces,
  previewSync,
  saveSyncSettings,
  setSyncToken,
  syncNow,
  syncWithMode,
  testSyncConnection,
} from "./api";
import { assertSyncStatus } from "./syncSettingsState";
import type {
  GitSyncSettings,
  GitSyncStatus,
  RemoteWorkspace,
  SyncResult,
  SyncMode,
  SyncPreview,
} from "./types";

type ActionState =
  | "idle"
  | "saving"
  | "testing"
  | "syncing"
  | "downloading"
  | "discovering";

const DEFAULT_SETTINGS: GitSyncSettings = {
  enabled: false,
  repositoryUrl: "",
  branch: "main",
  autoSync: true,
  intervalMinutes: 5,
  deviceId: "",
  workspaceName: "",
};

export function GitSyncSettingsSection() {
  const [status, setStatus] = useState<GitSyncStatus | null>(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [token, setToken] = useState("");
  const [action, setAction] = useState<ActionState>("idle");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [remoteWorkspaces, setRemoteWorkspaces] = useState<RemoteWorkspace[]>([]);
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null);

  useEffect(() => {
    void getSyncStatus()
      .then((next) => {
        setStatus(next);
        setSettings(next.settings);
      })
      .catch((error) => showError(error));
  }, []);

  const persist = async () => {
    if (token.trim()) {
      await setSyncToken(token);
      setToken("");
    }
    const next = await saveSyncSettings({
      ...settings,
      branch: settings.branch.trim() || "main",
      intervalMinutes: Math.max(1, Math.min(1440, settings.intervalMinutes || 5)),
    });
    assertSyncStatus(next);
    setStatus(next);
    setSettings(next.settings);
    notifySyncSettingsChanged();
    return next;
  };

  const save = async () => {
    setAction("saving");
    clearMessage();
    try {
      await persist();
      showSuccess("同步设置已保存");
    } catch (error) {
      showError(error);
    } finally {
      setAction("idle");
    }
  };

  const test = async () => {
    setAction("testing");
    clearMessage();
    try {
      await persist();
      const target = await testSyncConnection();
      showSuccess(`连接成功：${target}`);
    } catch (error) {
      showError(error);
    } finally {
      setAction("idle");
    }
  };

  const runSync = async () => {
    setAction("syncing");
    clearMessage();
    try {
      await persist();
      const preview = await previewSync();
      if (preview.requiresChoice) {
        setSyncPreview(preview);
        showSuccess(preview.message);
        return;
      }
      const result = await syncNow();
      const next = await getSyncStatus();
      setStatus(next);
      showSuccess(describeResult(result));
    } catch (error) {
      showError(error);
    } finally {
      setAction("idle");
    }
  };

  const runSelectedSync = async (mode: SyncMode) => {
    const label = mode === "localWins" ? "以本机为准" : "以云端为准";
    if (!window.confirm(`${label}会覆盖另一端对应内容，并重新建立同步基准。GitHub 历史仍可恢复。是否继续？`)) return;
    setAction("syncing");
    clearMessage();
    try {
      await persist();
      const result = await syncWithMode(mode);
      const next = await getSyncStatus();
      setStatus(next);
      setSyncPreview(null);
      showSuccess(`${label}同步完成。${describeResult(result)}`);
    } catch (error) {
      showError(error);
    } finally {
      setAction("idle");
    }
  };

  const runDownload = async () => {
    setAction("downloading");
    clearMessage();
    try {
      await persist();
      const result = await downloadSyncWorkspace();
      const next = await getSyncStatus();
      setStatus(next);
      showSuccess(
        `工作区「${result.workspaceName}」下载完成：写入本地 ${result.downloaded} 项，云端没有任何改动。`,
      );
    } catch (error) {
      showError(error);
    } finally {
      setAction("idle");
    }
  };

  const discoverWorkspaces = async () => {
    setAction("discovering");
    clearMessage();
    try {
      await persist();
      const workspaces = await listSyncWorkspaces();
      setRemoteWorkspaces(workspaces);
      showSuccess(
        workspaces.length
          ? `找到 ${workspaces.length} 个云端工作区，请从下方选择`
          : "仓库中还没有云端工作区，首次同步会自动创建",
      );
    } catch (error) {
      showError(error);
    } finally {
      setAction("idle");
    }
  };

  const clearToken = async () => {
    clearMessage();
    try {
      await clearSyncToken();
      setStatus((current) => (current ? { ...current, tokenStored: false } : current));
      showSuccess("已从 Windows 凭据管理器删除令牌");
    } catch (error) {
      showError(error);
    }
  };

  const changeEnabled = async (enabled: boolean) => {
    if (action !== "idle") return;
    const previousSettings = settings;
    const nextSettings = { ...settings, enabled };
    setSettings(nextSettings);
    setAction("saving");
    clearMessage();
    try {
      const nextStatus = await saveSyncSettings(nextSettings);
      assertSyncStatus(nextStatus);
      setStatus(nextStatus);
      setSettings(nextStatus.settings);
      notifySyncSettingsChanged();
      showSuccess(enabled ? "GitHub 同步已启用" : "GitHub 同步已暂停");
    } catch (error) {
      setSettings(previousSettings);
      showError(error);
    } finally {
      setAction("idle");
    }
  };

  function clearMessage() {
    setMessage("");
    setIsError(false);
  }

  function showSuccess(text: string) {
    setMessage(text);
    setIsError(false);
  }

  function showError(error: unknown) {
    const value =
      typeof error === "object" && error && "message" in error
        ? String((error as { message: unknown }).message)
        : String(error);
    setMessage(value);
    setIsError(true);
  }

  const busy = action !== "idle";

  return (
    <section className="space-y-3 pt-3 border-t border-paper-deep/25">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-ink-soft">GitHub 多设备同步</p>
          <p className="mt-1 text-[10px] leading-relaxed text-ink-ghost">
            不依赖本机 Git；令牌只保存在系统安全凭据中。
          </p>
        </div>
        <Switch
          checked={settings.enabled}
          disabled={busy}
          label="启用同步"
          onChange={(enabled) => void changeEnabled(enabled)}
        />
      </div>

      <label className="block space-y-1">
        <span className="text-[10px] text-ink-faint">私有仓库地址</span>
        <input
          value={settings.repositoryUrl}
          onChange={(event) =>
            setSettings((current) => ({ ...current, repositoryUrl: event.target.value }))
          }
          placeholder="https://github.com/用户名/仓库.git"
          className="w-full h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] text-ink-soft outline-none focus:border-bamboo/60"
        />
      </label>

      <div className="grid grid-cols-[1fr_88px] gap-2">
        <label className="block space-y-1">
          <span className="text-[10px] text-ink-faint">访问令牌</span>
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={status?.tokenStored ? "已安全保存；留空不修改" : "github_pat_…"}
            className="w-full h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] text-ink-soft outline-none focus:border-bamboo/60"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] text-ink-faint">分支</span>
          <input
            value={settings.branch}
            onChange={(event) =>
              setSettings((current) => ({ ...current, branch: event.target.value }))
            }
            className="w-full h-8 px-2.5 rounded-lg bg-paper-warm/70 border border-paper-deep/40 text-[11px] text-ink-soft outline-none focus:border-bamboo/60"
          />
        </label>
      </div>

      <div className="rounded-xl border border-bamboo/20 bg-bamboo-mist/20 p-2.5 space-y-2">
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1">
            <span className="text-[10px] text-ink-faint">当前云端工作区</span>
            <input
              value={settings.workspaceName}
              list="floral-remote-workspaces"
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  workspaceName: event.target.value,
                }))
              }
              placeholder="默认使用当前本地文件夹名称"
              className="w-full h-8 px-2.5 rounded-lg bg-paper/80 border border-paper-deep/40 text-[11px] text-ink-soft outline-none focus:border-bamboo/60"
            />
            <datalist id="floral-remote-workspaces">
              {remoteWorkspaces.map((workspace) => (
                <option key={workspace.path} value={workspace.name}>
                  {workspace.noteCount} 篇笔记
                </option>
              ))}
            </datalist>
          </label>
          <ActionButton disabled={busy} onClick={() => void discoverWorkspaces()}>
            {action === "discovering" ? "读取中…" : "读取云端"}
          </ActionButton>
        </div>
        {remoteWorkspaces.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {remoteWorkspaces.map((workspace) => (
              <button
                key={workspace.path}
                type="button"
                disabled={busy}
                onClick={() =>
                  setSettings((current) => ({
                    ...current,
                    workspaceName: workspace.name,
                  }))
                }
                className={`rounded-full border px-2 py-1 text-[9px] transition-colors ${
                  settings.workspaceName === workspace.name
                    ? "border-bamboo/45 bg-bamboo/10 text-bamboo"
                    : "border-paper-deep/35 bg-paper/60 text-ink-ghost hover:text-ink-faint"
                }`}
              >
                {workspace.name} · {workspace.noteCount} 篇
              </button>
            ))}
          </div>
        )}
        <p className="text-[9px] leading-relaxed text-ink-ghost">
          每个本地文件夹绑定一个云端工作区。新设备请先打开一个空文件夹，再“读取云端”、选择工作区并点击“下载云端”。
          下载按钮只读取 GitHub，不会上传或删除云端文件。
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Switch
          checked={settings.autoSync}
          disabled={busy}
          label="自动同步"
          onChange={(autoSync) => setSettings((current) => ({ ...current, autoSync }))}
        />
        <label className="flex items-center gap-1 text-[10px] text-ink-faint">
          每
          <input
            type="number"
            min={1}
            max={1440}
            value={settings.intervalMinutes}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                intervalMinutes: Number(event.target.value),
              }))
            }
            className="w-12 h-7 px-1.5 rounded-md bg-paper-warm/70 border border-paper-deep/40 text-center text-ink-soft outline-none"
          />
          分钟
        </label>
      </div>

      <p className="text-[10px] leading-relaxed text-ink-ghost">
        建议创建 Fine-grained token，只授予该仓库的
        <span className="text-ink-faint"> Contents：Read and write</span> 权限。不要把令牌写进笔记或仓库。
      </p>
      <p className="text-[10px] leading-relaxed text-ink-ghost">
        新电脑请用同一 GitHub 账号另建一个令牌：GitHub「Settings → Developer settings → Personal access tokens → Fine-grained tokens」。令牌无法从旧电脑找回明文，也不建议共用。
      </p>
      <p className="text-[10px] leading-relaxed text-ink-ghost">
        GitHub 会按{" "}
        <span className="font-mono text-ink-faint">
          workspaces/云端工作区/分类/笔记标题.md
        </span>{" "}
        分开保存。上传和下载只会处理当前选择的工作区。
      </p>

      <div className="flex flex-wrap gap-2">
        <ActionButton disabled={busy} onClick={() => void save()}>
          {action === "saving" ? "保存中…" : "保存"}
        </ActionButton>
        <ActionButton disabled={busy} onClick={() => void test()}>
          {action === "testing" ? "连接中…" : "测试连接"}
        </ActionButton>
        <ActionButton
          disabled={busy || !settings.workspaceName.trim()}
          onClick={() => void runDownload()}
        >
          {action === "downloading" ? "下载中…" : "下载云端"}
        </ActionButton>
        <ActionButton primary disabled={busy || !settings.enabled} onClick={() => void runSync()}>
          {action === "syncing" ? "同步中…" : "立即同步"}
        </ActionButton>
        {status?.tokenStored && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void clearToken()}
            className="h-8 px-2 text-[10px] text-ink-ghost hover:text-red-400 disabled:opacity-50"
          >
            删除令牌
          </button>
        )}
      </div>

      {syncPreview && (
        <div className="rounded-xl border border-amber-400/35 bg-amber-50/55 p-2.5 text-[10px] leading-relaxed text-ink-faint">
          <p className="font-medium text-ink-soft">需要选择同步方向</p>
          <p className="mt-1">本机 {syncPreview.localNotes} 篇 · 云端 {syncPreview.remoteNotes} 篇 · 内容不同 {syncPreview.differingNotes} 篇。</p>
          <p className="mt-1">
            {syncPreview.baselineAvailable
              ? "检测到双方正文都有修改。为避免自动生成冲突副本，请确认哪一端是最终版本。"
              : "未找到本机的上次同步基准。为避免自动生成冲突副本，请确认哪一端是最终版本。"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <ActionButton disabled={busy} onClick={() => void runSelectedSync("localWins")}>以本机为准</ActionButton>
            <ActionButton disabled={busy} onClick={() => void runSelectedSync("cloudWins")}>以云端为准</ActionButton>
            <ActionButton disabled={busy} onClick={() => setSyncPreview(null)}>暂不处理</ActionButton>
          </div>
        </div>
      )}

      {(message || status?.lastSyncAt || status?.lastError) && (
        <div
          className={`rounded-lg px-2.5 py-2 text-[10px] leading-relaxed ${
            isError || (!message && status?.lastError)
              ? "bg-red-50/70 text-red-500"
              : "bg-bamboo-mist/35 text-ink-faint"
          }`}
        >
          {message ||
            (status?.lastError
              ? `上次同步：${status.lastError}`
              : `上次同步：${formatTime(status?.lastSyncAt ?? null)}`)}
        </div>
      )}
    </section>
  );
}

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md text-[11px] text-ink-faint outline-none focus-visible:ring-2 focus-visible:ring-bamboo/35 ${
        disabled ? "cursor-wait opacity-60" : "cursor-pointer"
      }`}
    >
      <span
        aria-hidden="true"
        className={`relative block h-[18px] w-8 shrink-0 rounded-full transition-colors duration-200 ${
          checked ? "bg-bamboo" : "bg-paper-deep/50"
        }`}
      >
        <span
          className={`absolute left-[2px] top-[2px] block h-[14px] w-[14px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.15)] transition-transform duration-200 ${
            checked ? "translate-x-[14px]" : "translate-x-0"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

function ActionButton({
  children,
  disabled,
  primary = false,
  onClick,
}: {
  children: ReactNode;
  disabled: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-8 px-3 rounded-lg border text-[11px] transition-colors disabled:opacity-50 ${
        primary
          ? "border-bamboo/40 bg-bamboo text-white hover:bg-bamboo/90"
          : "border-paper-deep/45 text-ink-faint hover:text-bamboo hover:bg-bamboo-mist/40"
      }`}
    >
      {children}
    </button>
  );
}

function describeResult(result: SyncResult): string {
  if (!result.changed)
    return `工作区「${result.workspaceName}」云端与本地已经一致，纸张一张也没走丢。`;
  const details = [`上传 ${result.uploaded}`, `下载 ${result.downloaded}`];
  if (result.conflicts) details.push(`冲突副本 ${result.conflicts}`);
  return `工作区「${result.workspaceName}」同步完成：${details.join(" · ")}`;
}

function formatTime(value: string | null): string {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function notifySyncSettingsChanged() {
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent("floral-sync-settings-changed"));
  }, 0);
}
