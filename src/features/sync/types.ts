export interface GitSyncSettings {
  enabled: boolean;
  repositoryUrl: string;
  branch: string;
  autoSync: boolean;
  intervalMinutes: number;
  deviceId: string;
  workspaceName: string;
}

export interface GitSyncStatus {
  settings: GitSyncSettings;
  tokenStored: boolean;
  lastSyncAt: string | null;
  lastError: string;
}

export interface SyncRequest {
  categoryOrder: string[];
  noteOrder: string[];
  mode?: SyncMode;
}

export type SyncMode = "smart" | "localWins" | "cloudWins";

export interface SyncPreview {
  baselineAvailable: boolean;
  requiresChoice: boolean;
  localNotes: number;
  remoteNotes: number;
  differingNotes: number;
  message: string;
}

export interface RemoteWorkspace {
  name: string;
  path: string;
  noteCount: number;
  updatedAt: string | null;
}

export interface SyncResult {
  changed: boolean;
  uploaded: number;
  downloaded: number;
  conflicts: number;
  commitSha: string;
  syncedAt: string;
  categoryOrder: string[];
  noteOrder: string[];
  workspaceName: string;
}

export interface SyncLayoutEvent {
  categoryOrder: string[];
  noteOrder: string[];
}
