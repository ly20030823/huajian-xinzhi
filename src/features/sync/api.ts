import { invoke } from "@tauri-apps/api/core";
import type {
  GitSyncSettings,
  GitSyncStatus,
  RemoteWorkspace,
  SyncRequest,
  SyncResult,
} from "./types";

export const CATEGORY_ORDER_STORAGE_KEY = "floral-notepaper.category-order";
export const NOTE_ORDER_STORAGE_KEY = "floral-notepaper.note-order";

export function getSyncStatus(): Promise<GitSyncStatus> {
  return invoke("sync_settings_get");
}

export function saveSyncSettings(settings: GitSyncSettings): Promise<GitSyncStatus> {
  return invoke("sync_settings_save", { settings });
}

export function setSyncToken(token: string): Promise<void> {
  return invoke("sync_token_set", { token });
}

export function clearSyncToken(): Promise<void> {
  return invoke("sync_token_clear");
}

export function testSyncConnection(): Promise<string> {
  return invoke("sync_test_connection");
}

export function listSyncWorkspaces(): Promise<RemoteWorkspace[]> {
  return invoke("sync_workspaces_list");
}

export function syncNow(request: SyncRequest = readLocalLayout()): Promise<SyncResult> {
  return invoke("sync_now", { request });
}

export function downloadSyncWorkspace(): Promise<SyncResult> {
  return invoke("sync_download");
}

export function readLocalLayout(): SyncRequest {
  return {
    categoryOrder: readStringArray(CATEGORY_ORDER_STORAGE_KEY),
    noteOrder: readStringArray(NOTE_ORDER_STORAGE_KEY),
  };
}

function readStringArray(key: string): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
