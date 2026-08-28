use crate::{
    json_io::write_json_atomic,
    services::notes::{default_store, AppError, DocumentKind, Note, NoteStore, CLOUD_BINARY_LIMIT_BYTES},
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use chrono::{DateTime, Utc};
use keyring::{Entry, Error as KeyringError};
use reqwest::blocking::{Client, RequestBuilder};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const CONFIG_FILE: &str = "sync-config.json";
const LEGACY_STATE_FILE: &str = "sync-state.json";
const TOKEN_SERVICE: &str = "floral-notepaper";
const TOKEN_ACCOUNT: &str = "github-sync-token";
const LEGACY_MANIFEST_PATH: &str = "data/manifest.json";
const WORKSPACES_ROOT: &str = "workspaces";
const README_PATH: &str = "README.md";
const FORMAT_VERSION: u32 = 4;

static SYNC_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub repository_url: String,
    #[serde(default = "default_branch")]
    pub branch: String,
    #[serde(default = "default_auto_sync")]
    pub auto_sync: bool,
    #[serde(default = "default_interval")]
    pub interval_minutes: u32,
    #[serde(default = "default_device_id")]
    pub device_id: String,
    #[serde(default)]
    pub workspace_name: String,
}

impl Default for GitSyncSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            repository_url: String::new(),
            branch: default_branch(),
            auto_sync: default_auto_sync(),
            interval_minutes: default_interval(),
            device_id: default_device_id(),
            workspace_name: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSyncStatus {
    pub settings: GitSyncSettings,
    pub token_stored: bool,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub last_error: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    #[serde(default)]
    pub category_order: Vec<String>,
    #[serde(default)]
    pub note_order: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub changed: bool,
    pub uploaded: usize,
    pub downloaded: usize,
    pub conflicts: usize,
    pub commit_sha: String,
    pub synced_at: DateTime<Utc>,
    pub category_order: Vec<String>,
    pub note_order: Vec<String>,
    pub workspace_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteWorkspace {
    pub name: String,
    pub path: String,
    pub note_count: usize,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncLayoutEvent {
    category_order: Vec<String>,
    note_order: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncState {
    #[serde(default)]
    workspace_name: String,
    #[serde(default)]
    note_hashes: BTreeMap<String, String>,
    #[serde(default)]
    image_hashes: BTreeMap<String, String>,
    #[serde(default)]
    layout_hash: String,
    #[serde(default)]
    last_sync_at: Option<DateTime<Utc>>,
    #[serde(default)]
    last_error: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncManifest {
    #[serde(default)]
    format_version: u32,
    #[serde(default)]
    generated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    device_id: String,
    #[serde(default)]
    workspace_name: String,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    category_order: Vec<String>,
    #[serde(default)]
    note_order: Vec<String>,
    #[serde(default)]
    notes: Vec<ManifestNote>,
    #[serde(default)]
    images: Vec<ManifestImage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestNote {
    id: String,
    title: String,
    #[serde(default)]
    file_name: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    path: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    content_hash: String,
    record_hash: String,
    blob_sha: String,
    #[serde(default)]
    document_kind: DocumentKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    original_file_name: Option<String>,
    #[serde(default)]
    original_local_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestImage {
    path: String,
    content_hash: String,
    blob_sha: String,
}

#[derive(Debug, Clone)]
struct SnapshotNote {
    note: Note,
    content_hash: String,
    record_hash: String,
    blob_sha: String,
}

#[derive(Debug, Clone)]
struct SnapshotImage {
    path: String,
    content_hash: String,
    blob_sha: String,
    remote_bytes: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitRefObject {
    object: GitObject,
}

#[derive(Debug, Clone, Deserialize)]
struct GitObject {
    sha: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GitCommit {
    sha: String,
    tree: GitObject,
}

#[derive(Debug, Clone, Deserialize)]
struct GitTree {
    #[serde(default)]
    tree: Vec<GitTreeEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitTreeEntry {
    path: String,
    #[serde(rename = "type")]
    kind: String,
    sha: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GitBlob {
    content: String,
    encoding: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CreatedObject {
    sha: String,
}

struct GitHub {
    client: Client,
    token: String,
    owner: String,
    repo: String,
    branch: String,
}

#[tauri::command]
pub fn sync_settings_get() -> Result<GitSyncStatus, AppError> {
    let store = default_store()?;
    let settings = load_effective_settings(&store)?;
    let state = load_state(store.config_dir(), store.data_dir(), &settings)?;
    Ok(GitSyncStatus {
        settings,
        token_stored: token_get()?.is_some(),
        last_sync_at: state.last_sync_at,
        last_error: state.last_error,
    })
}

#[tauri::command]
pub fn sync_settings_save(mut settings: GitSyncSettings) -> Result<GitSyncStatus, AppError> {
    let store = default_store()?;
    let old = load_settings(store.config_dir())?;
    settings.repository_url = settings.repository_url.trim().trim_end_matches('/').to_string();
    settings.branch = settings.branch.trim().to_string();
    settings.interval_minutes = settings.interval_minutes.clamp(1, 1440);
    if settings.branch.is_empty() {
        settings.branch = default_branch();
    }
    if settings.device_id.trim().is_empty() {
        settings.device_id = old.device_id;
    }
    settings.workspace_name = store.set_workspace_name(&settings.workspace_name)?;
    if !settings.repository_url.is_empty() {
        parse_repository(&settings.repository_url)?;
    }
    write_json_atomic(&store.config_dir().join(CONFIG_FILE), &settings)?;
    sync_settings_get()
}

#[tauri::command]
pub fn sync_token_set(token: String) -> Result<(), AppError> {
    let token = token.trim();
    if token.is_empty() {
        return Err(AppError::new("syncTokenEmpty", "GitHub 访问令牌不能为空"));
    }
    token_entry()?
        .set_password(token)
        .map_err(keyring_error)
}

#[tauri::command]
pub fn sync_token_clear() -> Result<(), AppError> {
    match token_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(keyring_error(error)),
    }
}

#[tauri::command]
pub async fn sync_test_connection() -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(|| {
        let store = default_store()?;
        let settings = load_effective_settings(&store)?;
        let github = github_from_settings(&settings)?;
        let head = github.ensure_head()?;
        Ok(format!(
            "{}/{} · {} · 工作区「{}」",
            github.owner,
            github.repo,
            short_sha(&head.sha),
            settings.workspace_name
        ))
    })
    .await
    .map_err(|error| AppError::new("syncTask", error.to_string()))?
}

#[tauri::command]
pub async fn sync_workspaces_list() -> Result<Vec<RemoteWorkspace>, AppError> {
    tauri::async_runtime::spawn_blocking(|| {
        let store = default_store()?;
        let settings = load_effective_settings(&store)?;
        let github = github_from_settings(&settings)?;
        let head = github.ensure_head()?;
        let commit = github.commit(&head.sha)?;
        let tree = github.tree(&commit.tree.sha)?;
        let mut workspaces = Vec::new();
        for entry in &tree.tree {
            let Some(folder_name) = workspace_folder_from_manifest_path(&entry.path) else {
                continue;
            };
            if entry.kind != "blob" {
                continue;
            }
            let bytes = github.blob_bytes(&entry.sha)?;
            let manifest: SyncManifest = serde_json::from_slice(&bytes)?;
            let name = if manifest.workspace_name.trim().is_empty() {
                folder_name.to_string()
            } else {
                manifest.workspace_name
            };
            workspaces.push(RemoteWorkspace {
                name,
                path: entry.path.clone(),
                note_count: manifest.notes.len(),
                updated_at: manifest.generated_at,
            });
        }
        if let Some(entry) = tree
            .tree
            .iter()
            .find(|entry| entry.kind == "blob" && entry.path == LEGACY_MANIFEST_PATH)
        {
            let bytes = github.blob_bytes(&entry.sha)?;
            let manifest: SyncManifest = serde_json::from_slice(&bytes)?;
            let name = if manifest.workspace_name.trim().is_empty() {
                "旧版花笺".to_string()
            } else {
                manifest.workspace_name
            };
            workspaces.push(RemoteWorkspace {
                name,
                path: entry.path.clone(),
                note_count: manifest.notes.len(),
                updated_at: manifest.generated_at,
            });
        }
        workspaces.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(workspaces)
    })
    .await
    .map_err(|error| AppError::new("syncTask", error.to_string()))?
}

#[tauri::command]
pub async fn sync_now(app: AppHandle, request: SyncRequest) -> Result<SyncResult, AppError> {
    let app_for_task = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || perform_sync(request))
        .await
        .map_err(|error| AppError::new("syncTask", error.to_string()))?;

    match result {
        Ok(result) => {
            let _ = app_for_task.emit("sync-layout-applied", SyncLayoutEvent {
                category_order: result.category_order.clone(),
                note_order: result.note_order.clone(),
            });
            let _ = app_for_task.emit("notes-changed", ());
            Ok(result)
        }
        Err(error) => {
            if let Ok(store) = default_store() {
                if let Ok(settings) = load_effective_settings(&store) {
                    let mut state =
                        load_state(store.config_dir(), store.data_dir(), &settings)
                            .unwrap_or_default();
                    state.workspace_name = settings.workspace_name.clone();
                    state.last_error = error.message.clone();
                    let _ = write_json_atomic(
                        &state_path(store.config_dir(), store.data_dir(), &settings),
                        &state,
                    );
                }
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn sync_download(app: AppHandle) -> Result<SyncResult, AppError> {
    let app_for_task = app.clone();
    let result = tauri::async_runtime::spawn_blocking(perform_download)
        .await
        .map_err(|error| AppError::new("syncTask", error.to_string()))?;

    match result {
        Ok(result) => {
            let _ = app_for_task.emit("sync-layout-applied", SyncLayoutEvent {
                category_order: result.category_order.clone(),
                note_order: result.note_order.clone(),
            });
            let _ = app_for_task.emit("notes-changed", ());
            Ok(result)
        }
        Err(error) => {
            if let Ok(store) = default_store() {
                if let Ok(settings) = load_effective_settings(&store) {
                    let mut state =
                        load_state(store.config_dir(), store.data_dir(), &settings)
                            .unwrap_or_default();
                    state.workspace_name = settings.workspace_name.clone();
                    state.last_error = error.message.clone();
                    let _ = write_json_atomic(
                        &state_path(store.config_dir(), store.data_dir(), &settings),
                        &state,
                    );
                }
            }
            Err(error)
        }
    }
}

fn perform_download() -> Result<SyncResult, AppError> {
    let mutex = SYNC_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = mutex
        .try_lock()
        .map_err(|_| AppError::new("syncBusy", "另一轮同步正在进行，请稍候"))?;

    let store = default_store()?;
    let settings = load_effective_settings(&store)?;
    let github = github_from_settings(&settings)?;
    let workspace_root = workspace_repo_root(&settings.workspace_name);
    let manifest_path = workspace_manifest_path(&settings.workspace_name);
    let head = github.ensure_head()?;
    let commit = github.commit(&head.sha)?;
    let tree = github.tree(&commit.tree.sha)?;
    let tree_map = tree
        .tree
        .into_iter()
        .filter(|entry| entry.kind == "blob")
        .map(|entry| (entry.path, entry.sha))
        .collect::<BTreeMap<_, _>>();

    let (remote_manifest, legacy_remote) = if let Some(sha) = tree_map.get(&manifest_path) {
        let bytes = github.blob_bytes(sha)?;
        (serde_json::from_slice::<SyncManifest>(&bytes)?, false)
    } else if let Some(sha) = tree_map.get(LEGACY_MANIFEST_PATH) {
        let bytes = github.blob_bytes(sha)?;
        (serde_json::from_slice::<SyncManifest>(&bytes)?, true)
    } else {
        return Err(AppError::new(
            "syncWorkspaceMissing",
            format!(
                "云端没有找到工作区「{}」。请先点击“读取云端”，再选择已有工作区。",
                settings.workspace_name
            ),
        ));
    };
    if remote_manifest.format_version > FORMAT_VERSION {
        return Err(AppError::new(
            "syncFormatNewer",
            "云端同步格式比当前软件更新，请先升级花笺",
        ));
    }

    let local_notes = local_notes()?;
    ensure_download_target_is_empty(&local_notes)?;

    let remote_notes = load_remote_notes(
        &github,
        &remote_manifest,
        &tree_map,
        &workspace_root,
        legacy_remote,
    )?;
    let mut remote_images = BTreeMap::new();
    for image in &remote_manifest.images {
        let source_path = image.path.clone();
        let path = if legacy_remote {
            rebase_legacy_image_path(&workspace_root, &source_path)
                .unwrap_or_else(|| source_path.clone())
        } else {
            source_path.clone()
        };
        let blob_sha = tree_map
            .get(&source_path)
            .cloned()
            .unwrap_or_else(|| image.blob_sha.clone());
        if blob_sha.is_empty() {
            continue;
        }
        let bytes = github.blob_bytes(&blob_sha)?;
        remote_images.insert(
            path.clone(),
            SnapshotImage {
                path,
                content_hash: image.content_hash.clone(),
                blob_sha,
                remote_bytes: Some(bytes),
            },
        );
    }

    let mut remote_layout = Layout {
        categories: remote_manifest.categories.clone(),
        category_order: remote_manifest.category_order.clone(),
        note_order: remote_manifest.note_order.clone(),
    };
    normalize_layout(&mut remote_layout, &remote_notes);

    let normalized_notes = store.replace_from_sync(
        &remote_notes
            .values()
            .map(|note| note.note.clone())
            .collect::<Vec<_>>(),
        &remote_layout.categories,
    )?;
    reconcile_local_images(store.data_dir(), &workspace_root, &remote_images)?;
    let downloaded_notes = snapshot_notes(normalized_notes);

    let synced_at = Utc::now();
    let state = SyncState {
        workspace_name: settings.workspace_name.clone(),
        note_hashes: downloaded_notes
            .iter()
            .map(|(id, note)| (id.clone(), note.record_hash.clone()))
            .collect(),
        image_hashes: remote_images
            .iter()
            .map(|(path, image)| (path.clone(), image.content_hash.clone()))
            .collect(),
        layout_hash: layout_hash(&remote_layout),
        last_sync_at: Some(synced_at),
        last_error: String::new(),
    };
    write_json_atomic(
        &state_path(store.config_dir(), store.data_dir(), &settings),
        &state,
    )?;

    Ok(SyncResult {
        changed: !downloaded_notes.is_empty()
            || !remote_images.is_empty()
            || !remote_layout.categories.is_empty(),
        uploaded: 0,
        downloaded: downloaded_notes.len() + remote_images.len(),
        conflicts: 0,
        commit_sha: head.sha,
        synced_at,
        category_order: remote_layout.category_order,
        note_order: remote_layout.note_order,
        workspace_name: settings.workspace_name,
    })
}

fn perform_sync(request: SyncRequest) -> Result<SyncResult, AppError> {
    let mutex = SYNC_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = mutex
        .try_lock()
        .map_err(|_| AppError::new("syncBusy", "另一轮同步正在进行，请稍候"))?;

    let store = default_store()?;
    let settings = load_effective_settings(&store)?;
    if !settings.enabled {
        return Err(AppError::new("syncDisabled", "请先在设置里启用 GitHub 同步"));
    }
    let github = github_from_settings(&settings)?;
    let workspace_root = workspace_repo_root(&settings.workspace_name);
    let manifest_path = workspace_manifest_path(&settings.workspace_name);
    let head = github.ensure_head()?;
    let commit = github.commit(&head.sha)?;
    let tree = github.tree(&commit.tree.sha)?;
    let tree_map = tree
        .tree
        .into_iter()
        .filter(|entry| entry.kind == "blob")
        .map(|entry| (entry.path, entry.sha))
        .collect::<BTreeMap<_, _>>();

    let (remote_manifest, legacy_remote) = if let Some(sha) = tree_map.get(&manifest_path) {
        let bytes = github.blob_bytes(sha)?;
        let manifest: SyncManifest = serde_json::from_slice(&bytes)?;
        if manifest.format_version > FORMAT_VERSION {
            return Err(AppError::new(
                "syncFormatNewer",
                "云端同步格式比当前软件更新，请先升级花笺",
            ));
        }
        (manifest, false)
    } else if let Some(sha) = tree_map.get(LEGACY_MANIFEST_PATH) {
        let bytes = github.blob_bytes(sha)?;
        let manifest: SyncManifest = serde_json::from_slice(&bytes)?;
        if manifest.format_version > FORMAT_VERSION {
            return Err(AppError::new(
                "syncFormatNewer",
                "云端同步格式比当前软件更新，请先升级花笺",
            ));
        }
        (manifest, true)
    } else {
        (
            SyncManifest {
                workspace_name: settings.workspace_name.clone(),
                ..SyncManifest::default()
            },
            false,
        )
    };
    let mut state = load_state_for_sync(
        store.config_dir(),
        store.data_dir(),
        &settings,
        legacy_remote,
    )?;

    let local_all_notes = local_notes()?;
    let local_only_notes = local_all_notes
        .iter()
        .filter(|(_, note)| note.note.local_only)
        .map(|(id, note)| (id.clone(), note.clone()))
        .collect::<BTreeMap<_, _>>();
    let local_notes = local_all_notes
        .into_iter()
        .filter(|(_, note)| !note.note.local_only)
        .collect::<BTreeMap<_, _>>();
    let remote_notes = load_remote_notes(
        &github,
        &remote_manifest,
        &tree_map,
        &workspace_root,
        legacy_remote,
    )?;
    if should_protect_remote_from_empty_local(&local_notes, &remote_notes, &state.note_hashes) {
        return Err(AppError::new(
            "syncEmptyLocalProtected",
            format!(
                "已阻止同步：当前本地文件夹是空的，但云端工作区「{}」有 {} 篇笔记。为防止误删云端，请先使用空文件夹的首次下载流程，或切回原工作文件夹后再同步。",
                settings.workspace_name,
                remote_notes.len()
            ),
        ));
    }
    let (mut merged_notes, note_conflicts, note_downloads) =
        merge_notes(&local_notes, &remote_notes, &state.note_hashes);
    // Oversized PDFs are deliberately device-local. Keep them in the workspace
    // and layout, but never add them to the cloud manifest.
    merged_notes.extend(local_only_notes);
    let mut remote_note_paths_current = true;
    for entry in &remote_manifest.notes {
        if legacy_remote
            || manifest_note_repo_path(entry, &workspace_root, false)?
                != note_repo_path(&workspace_root, entry)
        {
            remote_note_paths_current = false;
            break;
        }
    }

    let local_categories = store.list_categories()?;
    let local_layout = Layout {
        categories: local_categories,
        category_order: request.category_order,
        note_order: request.note_order,
    };
    let remote_layout = Layout {
        categories: remote_manifest.categories.clone(),
        category_order: remote_manifest.category_order.clone(),
        note_order: remote_manifest.note_order.clone(),
    };
    let mut merged_layout = merge_layout(&local_layout, &remote_layout, &state.layout_hash);
    normalize_layout(&mut merged_layout, &merged_notes);

    let local_images = scan_local_images(store.data_dir(), &workspace_root)?;
    let remote_images = remote_manifest
        .images
        .iter()
        .map(|image| {
            let source_path = image.path.clone();
            let path = if legacy_remote {
                rebase_legacy_image_path(&workspace_root, &source_path)
                    .unwrap_or_else(|| source_path.clone())
            } else {
                source_path.clone()
            };
            (
                path.clone(),
                SnapshotImage {
                    path,
                    content_hash: image.content_hash.clone(),
                    blob_sha: tree_map
                        .get(&source_path)
                        .cloned()
                        .unwrap_or_else(|| image.blob_sha.clone()),
                    remote_bytes: None,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    let (mut merged_images, image_downloads) =
        merge_images(&local_images, &remote_images, &state.image_hashes);

    for image in merged_images.values_mut() {
        let local_matches = local_images
            .get(&image.path)
            .map(|local| local.content_hash == image.content_hash)
            .unwrap_or(false);
        if !local_matches {
            image.remote_bytes = Some(github.blob_bytes(&image.blob_sha)?);
        }
    }

    let normalized_notes = store.replace_from_sync(
        &merged_notes
            .values()
            .map(|note| note.note.clone())
            .collect::<Vec<_>>(),
        &merged_layout.categories,
    )?;
    reconcile_local_images(store.data_dir(), &workspace_root, &merged_images)?;
    merged_notes = snapshot_notes(normalized_notes);

    let remote_note_hashes = remote_notes
        .iter()
        .map(|(id, note)| (id.clone(), note.record_hash.clone()))
        .collect::<BTreeMap<_, _>>();
    let merged_note_hashes = merged_notes
        .iter()
        .filter(|(_, note)| !note.note.local_only)
        .map(|(id, note)| (id.clone(), note.record_hash.clone()))
        .collect::<BTreeMap<_, _>>();
    let remote_image_hashes = remote_images
        .iter()
        .map(|(path, image)| (path.clone(), image.content_hash.clone()))
        .collect::<BTreeMap<_, _>>();
    let merged_image_hashes = merged_images
        .iter()
        .map(|(path, image)| (path.clone(), image.content_hash.clone()))
        .collect::<BTreeMap<_, _>>();
    let merged_layout_hash = layout_hash(&merged_layout);
    let remote_layout_hash = layout_hash(&remote_layout);

    let readme_missing = !tree_map.contains_key(README_PATH);
    let changed = remote_note_hashes != merged_note_hashes
        || remote_image_hashes != merged_image_hashes
        || remote_layout_hash != merged_layout_hash
        || !remote_note_paths_current
        || !tree_map.contains_key(&manifest_path)
        || readme_missing;

    let mut uploaded = 0usize;
    let mut final_commit_sha = head.sha.clone();
    if changed {
        let mut entries = Vec::<Value>::new();
        let mut manifest_notes = Vec::new();
        let mut desired_paths = BTreeSet::new();

        for note in merged_notes.values_mut() {
            if note.note.local_only {
                continue;
            }
            let path = note_repo_path_for_note(&workspace_root, &note.note);
            desired_paths.insert(path.clone());
            let remote = remote_notes.get(&note.note.id);
            let blob_sha = if remote
                .map(|candidate| candidate.content_hash == note.content_hash)
                .unwrap_or(false)
            {
                remote.unwrap().blob_sha.clone()
            } else {
                uploaded += 1;
                if note.note.document_kind == DocumentKind::Pdf {
                    github.create_blob(note.note.binary_data.as_deref().unwrap_or_default())?
                } else {
                    github.create_blob(note.note.content.as_bytes())?
                }
            };
            note.blob_sha = blob_sha.clone();
            entries.push(tree_entry(&path, Some(&blob_sha)));
            manifest_notes.push(ManifestNote {
                id: note.note.id.clone(),
                title: note.note.title.clone(),
                file_name: note.note.file_name.clone(),
                category: note.note.category.clone(),
                path,
                created_at: note.note.created_at,
                updated_at: note.note.updated_at,
                content_hash: note.content_hash.clone(),
                record_hash: note.record_hash.clone(),
                blob_sha,
                document_kind: note.note.document_kind,
                original_file_name: note.note.original_file_name.clone(),
                original_local_only: note.note.original_local_only,
            });
        }

        let mut manifest_images = Vec::new();
        for image in merged_images.values_mut() {
            desired_paths.insert(image.path.clone());
            let remote = remote_images.get(&image.path);
            let blob_sha = if remote
                .map(|candidate| candidate.content_hash == image.content_hash)
                .unwrap_or(false)
            {
                remote.unwrap().blob_sha.clone()
            } else {
                uploaded += 1;
                let bytes =
                    fs::read(store.data_dir().join(path_from_repo(&image.path, &workspace_root)?))?;
                github.create_blob(&bytes)?
            };
            image.blob_sha = blob_sha.clone();
            entries.push(tree_entry(&image.path, Some(&blob_sha)));
            manifest_images.push(ManifestImage {
                path: image.path.clone(),
                content_hash: image.content_hash.clone(),
                blob_sha,
            });
        }

        for path in tree_map.keys() {
            let managed_current =
                is_managed_workspace_path(path, &workspace_root) && path != &manifest_path;
            let managed_legacy = legacy_remote
                && (path.starts_with("data/notes/")
                    || path.starts_with("data/images/")
                    || path == LEGACY_MANIFEST_PATH);
            if (managed_current || managed_legacy) && !desired_paths.contains(path) {
                entries.push(tree_entry(path, None));
            }
        }

        manifest_notes.sort_by(|left, right| left.id.cmp(&right.id));
        manifest_images.sort_by(|left, right| left.path.cmp(&right.path));
        // “仅本机”文档会保留在本地布局中，但不能写进云端清单；否则新设备会
        // 收到一个没有对应文件的悬空笔记 ID。
        let cloud_note_ids = manifest_notes
            .iter()
            .map(|note| note.id.as_str())
            .collect::<BTreeSet<_>>();
        let cloud_note_order = merged_layout
            .note_order
            .iter()
            .filter(|id| cloud_note_ids.contains(id.as_str()))
            .cloned()
            .collect();
        let manifest = SyncManifest {
            format_version: FORMAT_VERSION,
            generated_at: Some(Utc::now()),
            device_id: settings.device_id.clone(),
            workspace_name: settings.workspace_name.clone(),
            categories: merged_layout.categories.clone(),
            category_order: merged_layout.category_order.clone(),
            note_order: cloud_note_order,
            notes: manifest_notes,
            images: manifest_images,
        };
        let manifest_bytes = serde_json::to_vec_pretty(&manifest)?;
        let manifest_sha = github.create_blob(&manifest_bytes)?;
        entries.push(tree_entry(&manifest_path, Some(&manifest_sha)));

        if readme_missing {
            let readme_sha = github.create_blob(sync_readme().as_bytes())?;
            entries.push(tree_entry(README_PATH, Some(&readme_sha)));
        }

        let new_tree = github.create_tree(&commit.tree.sha, entries)?;
        let message = format!(
            "🌼 花笺同步 · {} · {} · {} 篇笔记",
            short_device(&settings.device_id),
            settings.workspace_name,
            merged_notes.len()
        );
        let new_commit = github.create_commit(&message, &new_tree, &head.sha)?;
        github.update_ref(&new_commit)?;
        final_commit_sha = new_commit;
    }

    let synced_at = Utc::now();
    state.note_hashes = merged_note_hashes;
    state.image_hashes = merged_image_hashes;
    state.layout_hash = merged_layout_hash;
    state.last_sync_at = Some(synced_at);
    state.last_error.clear();
    state.workspace_name = settings.workspace_name.clone();
    write_json_atomic(
        &state_path(store.config_dir(), store.data_dir(), &settings),
        &state,
    )?;

    Ok(SyncResult {
        changed,
        uploaded,
        downloaded: note_downloads + image_downloads,
        conflicts: note_conflicts,
        commit_sha: final_commit_sha,
        synced_at,
        category_order: merged_layout.category_order,
        note_order: merged_layout.note_order,
        workspace_name: settings.workspace_name,
    })
}

#[derive(Debug, Clone)]
struct Layout {
    categories: Vec<String>,
    category_order: Vec<String>,
    note_order: Vec<String>,
}

fn merge_notes(
    local: &BTreeMap<String, SnapshotNote>,
    remote: &BTreeMap<String, SnapshotNote>,
    base: &BTreeMap<String, String>,
) -> (BTreeMap<String, SnapshotNote>, usize, usize) {
    let ids = local
        .keys()
        .chain(remote.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut result = BTreeMap::new();
    let mut conflicts = 0;
    let mut downloads = 0;

    for id in ids {
        let local_note = local.get(&id);
        let remote_note = remote.get(&id);
        let base_hash = base.get(&id);
        match (local_note, remote_note) {
            (Some(left), Some(right)) if left.record_hash == right.record_hash => {
                result.insert(id, left.clone());
            }
            (Some(left), Some(right)) if base_hash == Some(&left.record_hash) => {
                result.insert(id, right.clone());
                downloads += 1;
            }
            (Some(left), Some(right)) if base_hash == Some(&right.record_hash) => {
                result.insert(id, left.clone());
            }
            (Some(left), Some(right)) => {
                result.insert(id, left.clone());
                let mut conflict = right.clone();
                let conflict_id = Uuid::new_v4().to_string();
                conflict.note.id = conflict_id.clone();
                conflict.note.file_name = format!("{conflict_id}.md");
                conflict.note.title = format!("{}（同步冲突副本）", conflict.note.title);
                conflict.note.updated_at = Utc::now();
                conflict.content_hash = hash_bytes(conflict.note.content.as_bytes());
                conflict.record_hash = note_record_hash(&conflict.note, &conflict.content_hash);
                result.insert(conflict_id, conflict);
                conflicts += 1;
                downloads += 1;
            }
            (Some(left), None) => {
                if base_hash != Some(&left.record_hash) {
                    result.insert(id, left.clone());
                }
            }
            (None, Some(right)) => {
                if base_hash != Some(&right.record_hash) {
                    result.insert(id, right.clone());
                    downloads += 1;
                }
            }
            (None, None) => {}
        }
    }
    (result, conflicts, downloads)
}

fn should_protect_remote_from_empty_local(
    local: &BTreeMap<String, SnapshotNote>,
    remote: &BTreeMap<String, SnapshotNote>,
    base: &BTreeMap<String, String>,
) -> bool {
    local.is_empty()
        && !remote.is_empty()
        && remote.iter().any(|(id, note)| {
            base.get(id)
                .is_some_and(|hash| hash == &note.record_hash)
        })
}

fn ensure_download_target_is_empty(
    local: &BTreeMap<String, SnapshotNote>,
) -> Result<(), AppError> {
    if local.is_empty() {
        return Ok(());
    }
    Err(AppError::new(
        "syncDownloadLocalNotEmpty",
        format!(
            "为保护本地内容，“下载云端”只能用于没有笔记的文件夹。当前文件夹已有 {} 篇笔记；请改用“立即同步”，或先打开一个空文件夹。",
            local.len()
        ),
    ))
}

fn merge_images(
    local: &BTreeMap<String, SnapshotImage>,
    remote: &BTreeMap<String, SnapshotImage>,
    base: &BTreeMap<String, String>,
) -> (BTreeMap<String, SnapshotImage>, usize) {
    let paths = local
        .keys()
        .chain(remote.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut result = BTreeMap::new();
    let mut downloads = 0;
    for path in paths {
        let left = local.get(&path);
        let right = remote.get(&path);
        let base_hash = base.get(&path);
        match (left, right) {
            (Some(local), Some(remote)) if local.content_hash == remote.content_hash => {
                result.insert(path, local.clone());
            }
            (Some(local), Some(remote)) if base_hash == Some(&local.content_hash) => {
                result.insert(path, remote.clone());
                downloads += 1;
            }
            (Some(local), Some(remote)) if base_hash == Some(&remote.content_hash) => {
                result.insert(path, local.clone());
            }
            (Some(local), Some(_)) => {
                result.insert(path, local.clone());
            }
            (Some(local), None) => {
                if base_hash != Some(&local.content_hash) {
                    result.insert(path, local.clone());
                }
            }
            (None, Some(remote)) => {
                if base_hash != Some(&remote.content_hash) {
                    result.insert(path, remote.clone());
                    downloads += 1;
                }
            }
            (None, None) => {}
        }
    }
    (result, downloads)
}

fn merge_layout(local: &Layout, remote: &Layout, base_hash: &str) -> Layout {
    let local_hash = layout_hash(local);
    let remote_hash = layout_hash(remote);
    if local_hash == remote_hash || remote.categories.is_empty() && remote.note_order.is_empty() {
        return local.clone();
    }
    if local.categories.is_empty() && local.note_order.is_empty() {
        return remote.clone();
    }
    if base_hash == local_hash {
        return remote.clone();
    }
    if base_hash == remote_hash {
        return local.clone();
    }
    Layout {
        categories: ordered_union(&local.categories, &remote.categories),
        category_order: ordered_union(&local.category_order, &remote.category_order),
        note_order: ordered_union(&local.note_order, &remote.note_order),
    }
}

fn normalize_layout(layout: &mut Layout, notes: &BTreeMap<String, SnapshotNote>) {
    let note_categories = notes
        .values()
        .filter_map(|note| {
            let category = note.note.category.trim();
            (!category.is_empty()).then(|| category.to_string())
        })
        .collect::<Vec<_>>();
    layout.categories = ordered_union(&layout.categories, &note_categories);
    layout.category_order = ordered_union(&layout.category_order, &layout.categories);
    let note_ids = notes.keys().cloned().collect::<Vec<_>>();
    layout.note_order.retain(|id| notes.contains_key(id));
    layout.note_order = ordered_union(&layout.note_order, &note_ids);
}

fn ordered_union(left: &[String], right: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    left.iter()
        .chain(right)
        .filter(|item| seen.insert((*item).clone()))
        .cloned()
        .collect()
}

fn local_notes() -> Result<BTreeMap<String, SnapshotNote>, AppError> {
    let store = default_store()?;
    let notes = store
        .list_notes()?
        .into_iter()
        .map(|metadata| store.read_note(&metadata.id))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(snapshot_notes(notes))
}

fn snapshot_notes(notes: Vec<Note>) -> BTreeMap<String, SnapshotNote> {
    notes
        .into_iter()
        .map(|note| {
            let content_hash = if note.document_kind == DocumentKind::Pdf {
                hash_bytes(note.binary_data.as_deref().unwrap_or_default())
            } else {
                hash_bytes(note.content.as_bytes())
            };
            let record_hash = note_record_hash(&note, &content_hash);
            (
                note.id.clone(),
                SnapshotNote {
                    note,
                    content_hash,
                    record_hash,
                    blob_sha: String::new(),
                },
            )
        })
        .collect()
}

fn load_remote_notes(
    github: &GitHub,
    manifest: &SyncManifest,
    tree: &BTreeMap<String, String>,
    workspace_root: &str,
    legacy_remote: bool,
) -> Result<BTreeMap<String, SnapshotNote>, AppError> {
    let mut result = BTreeMap::new();
    for entry in &manifest.notes {
        let path = manifest_note_repo_path(entry, workspace_root, legacy_remote)?;
        let sha = tree
            .get(&path)
            .cloned()
            .unwrap_or_else(|| entry.blob_sha.clone());
        if sha.is_empty() {
            continue;
        }
        let bytes = github.blob_bytes(&sha)?;
        let (content, binary_data) = if entry.document_kind == DocumentKind::Pdf {
            (String::new(), Some(bytes))
        } else {
            (
                String::from_utf8(bytes)
                    .map_err(|error| AppError::new("syncEncoding", error.to_string()))?,
                None,
            )
        };
        let note = Note {
            id: entry.id.clone(),
            title: entry.title.clone(),
            file_name: if entry.file_name.trim().is_empty() {
                sync_file_name(&entry.title, &entry.id)
            } else {
                entry.file_name.clone()
            },
            category: entry.category.clone(),
            created_at: entry.created_at,
            updated_at: entry.updated_at,
            word_count: 0,
            content,
            document_kind: entry.document_kind,
            original_file_name: entry.original_file_name.clone(),
            local_only: false,
            original_local_only: entry.original_local_only,
            binary_data,
        };
        result.insert(
            entry.id.clone(),
            SnapshotNote {
                note,
                content_hash: entry.content_hash.clone(),
                record_hash: entry.record_hash.clone(),
                blob_sha: sha,
            },
        );
    }
    Ok(result)
}

fn scan_local_images(
    data_dir: &Path,
    workspace_root: &str,
) -> Result<BTreeMap<String, SnapshotImage>, AppError> {
    let root = data_dir.join("images");
    let mut result = BTreeMap::new();
    if !root.exists() {
        return Ok(result);
    }
    for note_dir in fs::read_dir(&root)? {
        let note_dir = note_dir?;
        if !note_dir.path().is_dir() {
            continue;
        }
        for file in fs::read_dir(note_dir.path())? {
            let file = file?;
            if !file.path().is_file() {
                continue;
            }
            let path = format!(
                "{workspace_root}/images/{}/{}",
                note_dir.file_name().to_string_lossy(),
                file.file_name().to_string_lossy()
            );
            let bytes = fs::read(file.path())?;
            result.insert(
                path.clone(),
                SnapshotImage {
                    path,
                    content_hash: hash_bytes(&bytes),
                    blob_sha: String::new(),
                    remote_bytes: None,
                },
            );
        }
    }
    let originals_root = data_dir.join(".floral-originals");
    if originals_root.exists() {
        scan_local_binary_assets(
            &originals_root,
            &originals_root,
            workspace_root,
            &mut result,
        )?;
    }
    Ok(result)
}

fn scan_local_binary_assets(
    root: &Path,
    directory: &Path,
    workspace_root: &str,
    result: &mut BTreeMap<String, SnapshotImage>,
) -> Result<(), AppError> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            scan_local_binary_assets(root, &path, workspace_root, result)?;
            continue;
        }
        if !path.is_file() || entry.metadata()?.len() > CLOUD_BINARY_LIMIT_BYTES {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| AppError::new("syncPath", "原始文档路径无效"))?
            .to_string_lossy()
            .replace('\\', "/");
        let repo_path = format!("{workspace_root}/.floral-originals/{relative}");
        let bytes = fs::read(&path)?;
        result.insert(
            repo_path.clone(),
            SnapshotImage {
                path: repo_path,
                content_hash: hash_bytes(&bytes),
                blob_sha: String::new(),
                remote_bytes: None,
            },
        );
    }
    Ok(())
}

fn reconcile_local_images(
    data_dir: &Path,
    workspace_root: &str,
    images: &BTreeMap<String, SnapshotImage>,
) -> Result<(), AppError> {
    let existing = scan_local_images(data_dir, workspace_root)?;
    for path in existing.keys() {
        if !images.contains_key(path) {
            let local = data_dir.join(path_from_repo(path, workspace_root)?);
            if local.is_file() {
                fs::remove_file(local)?;
            }
        }
    }
    for image in images.values() {
        if let Some(bytes) = &image.remote_bytes {
            let local = data_dir.join(path_from_repo(&image.path, workspace_root)?);
            if let Some(parent) = local.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(local, bytes)?;
        }
    }
    Ok(())
}

impl GitHub {
    fn new(token: String, owner: String, repo: String, branch: String) -> Result<Self, AppError> {
        let client = Client::builder()
            .user_agent("FloralNotepaper/1.0")
            .timeout(std::time::Duration::from_secs(45))
            .build()
            .map_err(http_error)?;
        Ok(Self {
            client,
            token,
            owner,
            repo,
            branch,
        })
    }

    fn api(&self, path: &str) -> String {
        format!(
            "https://api.github.com/repos/{}/{}/{}",
            self.owner, self.repo, path
        )
    }

    fn request(&self, request: RequestBuilder) -> RequestBuilder {
        request
            .bearer_auth(&self.token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
    }

    fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, AppError> {
        self.send_json(self.request(self.client.get(self.api(path))))
    }

    fn post<T: DeserializeOwned>(&self, path: &str, body: Value) -> Result<T, AppError> {
        self.send_json(self.request(self.client.post(self.api(path))).json(&body))
    }

    fn send_json<T: DeserializeOwned>(&self, request: RequestBuilder) -> Result<T, AppError> {
        let response = request.send().map_err(http_error)?;
        let status = response.status();
        let text = response.text().map_err(http_error)?;
        if !status.is_success() {
            let message = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|value| value.get("message")?.as_str().map(str::to_string))
                .unwrap_or(text);
            return Err(AppError::new(
                "githubApi",
                format!("GitHub 返回 {}：{}", status.as_u16(), message),
            ));
        }
        serde_json::from_str(&text).map_err(Into::into)
    }

    fn ensure_head(&self) -> Result<GitCommit, AppError> {
        let path = format!("git/ref/heads/{}", self.branch);
        let response = self.request(self.client.get(self.api(&path))).send().map_err(http_error)?;
        if response.status().is_success() {
            let reference: GitRefObject = response.json().map_err(http_error)?;
            return self.commit(&reference.object.sha);
        }
        if response.status().as_u16() != 404 {
            let status = response.status();
            let text = response.text().unwrap_or_default();
            return Err(AppError::new(
                "githubApi",
                format!("GitHub 返回 {}：{}", status.as_u16(), text),
            ));
        }

        let body = json!({
            "message": "🌱 给花笺准备一只云端抽屉",
            "content": BASE64_STANDARD.encode(sync_readme().as_bytes()),
            "branch": self.branch,
        });
        let _: Value = self.send_json(
            self.request(self.client.put(self.api("contents/README.md")))
                .json(&body),
        )?;
        let reference: GitRefObject = self.get(&path)?;
        self.commit(&reference.object.sha)
    }

    fn commit(&self, sha: &str) -> Result<GitCommit, AppError> {
        self.get(&format!("git/commits/{sha}"))
    }

    fn tree(&self, sha: &str) -> Result<GitTree, AppError> {
        self.get(&format!("git/trees/{sha}?recursive=1"))
    }

    fn blob_bytes(&self, sha: &str) -> Result<Vec<u8>, AppError> {
        let blob: GitBlob = self.get(&format!("git/blobs/{sha}"))?;
        if blob.encoding != "base64" {
            return Err(AppError::new("githubEncoding", "GitHub 返回了未知的文件编码"));
        }
        let compact = blob.content.chars().filter(|ch| !ch.is_whitespace()).collect::<String>();
        BASE64_STANDARD
            .decode(compact)
            .map_err(|error| AppError::new("githubEncoding", error.to_string()))
    }

    fn create_blob(&self, bytes: &[u8]) -> Result<String, AppError> {
        let created: CreatedObject = self.post(
            "git/blobs",
            json!({
                "content": BASE64_STANDARD.encode(bytes),
                "encoding": "base64",
            }),
        )?;
        Ok(created.sha)
    }

    fn create_tree(&self, base_tree: &str, tree: Vec<Value>) -> Result<String, AppError> {
        let created: CreatedObject =
            self.post("git/trees", json!({ "base_tree": base_tree, "tree": tree }))?;
        Ok(created.sha)
    }

    fn create_commit(&self, message: &str, tree: &str, parent: &str) -> Result<String, AppError> {
        let created: CreatedObject = self.post(
            "git/commits",
            json!({ "message": message, "tree": tree, "parents": [parent] }),
        )?;
        Ok(created.sha)
    }

    fn update_ref(&self, sha: &str) -> Result<(), AppError> {
        let path = format!("git/refs/heads/{}", self.branch);
        let _: Value = self.send_json(
            self.request(self.client.patch(self.api(&path)))
                .json(&json!({ "sha": sha, "force": false })),
        )?;
        Ok(())
    }
}

fn github_from_settings(settings: &GitSyncSettings) -> Result<GitHub, AppError> {
    if settings.repository_url.trim().is_empty() {
        return Err(AppError::new("syncRepositoryEmpty", "请填写 GitHub 仓库地址"));
    }
    let (owner, repo) = parse_repository(&settings.repository_url)?;
    let token = token_get()?.ok_or_else(|| {
        AppError::new(
            "syncTokenMissing",
            "尚未保存 GitHub 访问令牌，请在同步设置中填写",
        )
    })?;
    GitHub::new(token, owner, repo, settings.branch.clone())
}

fn parse_repository(url: &str) -> Result<(String, String), AppError> {
    let mut value = url.trim().trim_end_matches('/').to_string();
    for prefix in ["https://github.com/", "http://github.com/", "git@github.com:"] {
        if let Some(rest) = value.strip_prefix(prefix) {
            value = rest.to_string();
            break;
        }
    }
    value = value.trim_end_matches(".git").to_string();
    let parts = value.split('/').collect::<Vec<_>>();
    if parts.len() != 2 || parts.iter().any(|part| !valid_repo_part(part)) {
        return Err(AppError::new(
            "syncRepositoryInvalid",
            "仓库地址应类似 https://github.com/用户名/仓库名.git",
        ));
    }
    Ok((parts[0].to_string(), parts[1].to_string()))
}

fn valid_repo_part(value: &str) -> bool {
    !value.is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        && value != "."
        && value != ".."
}

fn load_settings(config_dir: &Path) -> Result<GitSyncSettings, AppError> {
    let path = config_dir.join(CONFIG_FILE);
    if !path.exists() {
        let settings = GitSyncSettings::default();
        write_json_atomic(&path, &settings)?;
        return Ok(settings);
    }
    let mut settings: GitSyncSettings = serde_json::from_str(&fs::read_to_string(path)?)?;
    settings.interval_minutes = settings.interval_minutes.clamp(1, 1440);
    if settings.device_id.trim().is_empty() {
        settings.device_id = default_device_id();
    }
    Ok(settings)
}

fn load_effective_settings(store: &NoteStore) -> Result<GitSyncSettings, AppError> {
    let mut settings = load_settings(store.config_dir())?;
    settings.workspace_name = store.workspace_name()?;
    Ok(settings)
}

fn state_path(
    config_dir: &Path,
    data_dir: &Path,
    settings: &GitSyncSettings,
) -> PathBuf {
    let resolved_data_dir = fs::canonicalize(data_dir).unwrap_or_else(|_| data_dir.to_path_buf());
    let mut data_dir_key = resolved_data_dir.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    data_dir_key.make_ascii_lowercase();
    let identity = json!({
        "dataDir": data_dir_key,
        "repository": settings.repository_url.trim().trim_end_matches('/').to_ascii_lowercase(),
        "branch": settings.branch.trim(),
        "workspace": settings.workspace_name.trim(),
    });
    let hash = hash_bytes(identity.to_string().as_bytes());
    config_dir.join(format!(
        "sync-state-{}.json",
        hash.get(..16).unwrap_or(&hash)
    ))
}

fn load_state(
    config_dir: &Path,
    data_dir: &Path,
    settings: &GitSyncSettings,
) -> Result<SyncState, AppError> {
    let path = state_path(config_dir, data_dir, settings);
    if !path.exists() {
        return Ok(SyncState::default());
    }
    let state: SyncState = serde_json::from_str(&fs::read_to_string(path)?)?;
    if !state.workspace_name.is_empty() && state.workspace_name != settings.workspace_name {
        return Ok(SyncState::default());
    }
    Ok(state)
}

fn load_state_for_sync(
    config_dir: &Path,
    data_dir: &Path,
    settings: &GitSyncSettings,
    legacy_remote: bool,
) -> Result<SyncState, AppError> {
    let current_path = state_path(config_dir, data_dir, settings);
    if current_path.exists() || !legacy_remote {
        return load_state(config_dir, data_dir, settings);
    }
    let legacy_path = config_dir.join(LEGACY_STATE_FILE);
    if !legacy_path.exists() {
        return Ok(SyncState::default());
    }
    let mut state: SyncState = serde_json::from_str(&fs::read_to_string(legacy_path)?)?;
    state.workspace_name = settings.workspace_name.clone();
    Ok(state)
}

fn token_entry() -> Result<Entry, AppError> {
    Entry::new(TOKEN_SERVICE, TOKEN_ACCOUNT).map_err(keyring_error)
}

fn token_get() -> Result<Option<String>, AppError> {
    match token_entry()?.get_password() {
        Ok(value) => Ok((!value.trim().is_empty()).then(|| value.trim().to_string())),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(keyring_error(error)),
    }
}

fn keyring_error(error: impl std::fmt::Display) -> AppError {
    AppError::new(
        "syncSecureStore",
        format!("无法使用系统安全凭据存储：{error}"),
    )
}

fn http_error(error: reqwest::Error) -> AppError {
    AppError::new("githubNetwork", format!("连接 GitHub 失败：{error}"))
}

fn workspace_repo_root(workspace_name: &str) -> String {
    format!(
        "{WORKSPACES_ROOT}/{}",
        readable_repo_segment(workspace_name, "我的花笺")
    )
}

fn workspace_manifest_path(workspace_name: &str) -> String {
    format!("{}/manifest.json", workspace_repo_root(workspace_name))
}

fn workspace_folder_from_manifest_path(path: &str) -> Option<&str> {
    let relative = path.strip_prefix(&format!("{WORKSPACES_ROOT}/"))?;
    let mut parts = relative.split('/');
    let folder = parts.next()?;
    let file = parts.next()?;
    if folder.is_empty() || file != "manifest.json" || parts.next().is_some() {
        return None;
    }
    Some(folder)
}

fn note_repo_path(workspace_root: &str, note: &ManifestNote) -> String {
    let file_name = if note.file_name.trim().is_empty() {
        sync_file_name(&note.title, &note.id)
    } else {
        readable_repo_file_name(&note.file_name, &note.title, &note.id)
    };
    if note.category.trim().is_empty() {
        format!("{workspace_root}/{file_name}")
    } else {
        format!(
            "{workspace_root}/{}/{}",
            readable_repo_segment(&note.category, "文件夹"),
            file_name
        )
    }
}

fn note_repo_path_for_note(workspace_root: &str, note: &Note) -> String {
    let file_name = readable_repo_file_name(&note.file_name, &note.title, &note.id);
    if note.category.trim().is_empty() {
        format!("{workspace_root}/{file_name}")
    } else {
        format!(
            "{workspace_root}/{}/{}",
            readable_repo_segment(&note.category, "文件夹"),
            file_name
        )
    }
}

fn legacy_note_repo_path(id: &str) -> String {
    format!("data/notes/{}.md", legacy_repo_file_stem(id))
}

fn manifest_note_repo_path(
    note: &ManifestNote,
    workspace_root: &str,
    legacy_remote: bool,
) -> Result<String, AppError> {
    let path = if note.path.trim().is_empty() {
        if legacy_remote {
            legacy_note_repo_path(&note.id)
        } else {
            note_repo_path(workspace_root, note)
        }
    } else {
        note.path.trim().replace('\\', "/")
    };
    validate_note_repo_path(&path, workspace_root, legacy_remote)?;
    Ok(path)
}

fn readable_repo_segment(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    let mut sanitized = trimmed
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    sanitized = sanitized
        .trim_matches(|character| character == ' ' || character == '.')
        .to_string();
    if sanitized.is_empty() {
        sanitized = fallback.to_string();
    }
    if sanitized != trimmed {
        let suffix = hash_bytes(trimmed.as_bytes());
        sanitized.push('-');
        sanitized.push_str(suffix.get(..8).unwrap_or(&suffix));
    }
    sanitized
}

fn legacy_repo_file_stem(id: &str) -> String {
    if !id.is_empty()
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return id.to_string();
    }
    let hash = hash_bytes(id.as_bytes());
    format!("note-{}", hash.get(..16).unwrap_or(&hash))
}

fn sync_file_name(title: &str, id: &str) -> String {
    readable_repo_file_name("", title, id)
}

fn readable_repo_file_name(file_name: &str, title: &str, id: &str) -> String {
    let requested = Path::new(file_name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| value.to_ascii_lowercase().ends_with(".md"))
        .map(str::to_string)
        .unwrap_or_else(|| format!("{}.md", title.trim()));
    let stem = requested
        .strip_suffix(".md")
        .or_else(|| requested.strip_suffix(".MD"))
        .unwrap_or(&requested);
    let sanitized = readable_repo_segment(stem, "未命名");
    if sanitized == "未命名" && title.trim().is_empty() {
        let suffix = hash_bytes(id.as_bytes());
        format!("未命名-{}.md", suffix.get(..8).unwrap_or(&suffix))
    } else {
        format!("{sanitized}.md")
    }
}

fn validate_note_repo_path(
    path: &str,
    workspace_root: &str,
    legacy_remote: bool,
) -> Result<(), AppError> {
    let prefix = if legacy_remote {
        "data/notes/".to_string()
    } else {
        format!("{workspace_root}/")
    };
    let Some(relative) = path.strip_prefix(&prefix) else {
        return Err(AppError::new("syncPath", "云端笔记路径不安全"));
    };
    let components = relative.split('/').collect::<Vec<_>>();
    if components.is_empty()
        || components.iter().any(|part| {
            part.is_empty()
                || *part == "."
                || *part == ".."
                || part.contains('\\')
                || part.chars().any(char::is_control)
        })
        || !components.last().is_some_and(|file| file.ends_with(".md"))
    {
        return Err(AppError::new("syncPath", "云端笔记路径不安全"));
    }
    Ok(())
}

fn is_managed_workspace_path(path: &str, workspace_root: &str) -> bool {
    path.strip_prefix(&format!("{workspace_root}/"))
        .is_some_and(|relative| relative.starts_with("images/") || relative.ends_with(".md"))
}

fn rebase_legacy_image_path(workspace_root: &str, path: &str) -> Option<String> {
    path.strip_prefix("data/images/")
        .map(|relative| format!("{workspace_root}/images/{relative}"))
}

fn tree_entry(path: &str, sha: Option<&str>) -> Value {
    json!({
        "path": path,
        "mode": "100644",
        "type": "blob",
        "sha": sha,
    })
}

fn path_from_repo(path: &str, workspace_root: &str) -> Result<PathBuf, AppError> {
    let relative = path
        .strip_prefix(&format!("{workspace_root}/"))
        .ok_or_else(|| AppError::new("syncPath", "云端文件路径不安全"))?;
    let parsed = PathBuf::from(relative);
    if parsed
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::new("syncPath", "云端文件路径不安全"));
    }
    if !relative.starts_with("images/") && !relative.starts_with(".floral-originals/") {
        return Err(AppError::new("syncPath", "云端附件路径不安全"));
    }
    Ok(parsed)
}

fn note_record_hash(note: &Note, content_hash: &str) -> String {
    let value = json!({
        "title": note.title,
        "category": note.category,
        "createdAt": note.created_at,
        "updatedAt": note.updated_at,
        "contentHash": content_hash,
        "documentKind": note.document_kind,
        "originalFileName": note.original_file_name,
        "originalLocalOnly": note.original_local_only,
    });
    hash_bytes(value.to_string().as_bytes())
}

fn layout_hash(layout: &Layout) -> String {
    hash_bytes(
        serde_json::to_string(&json!({
            "categories": layout.categories,
            "categoryOrder": layout.category_order,
            "noteOrder": layout.note_order,
        }))
        .unwrap_or_default()
        .as_bytes(),
    )
}

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn short_sha(value: &str) -> &str {
    value.get(..7).unwrap_or(value)
}

fn short_device(value: &str) -> &str {
    value.get(..8).unwrap_or(value)
}

fn default_branch() -> String {
    "main".to_string()
}

fn default_auto_sync() -> bool {
    true
}

fn default_interval() -> u32 {
    5
}

fn default_device_id() -> String {
    Uuid::new_v4().to_string()
}

fn sync_readme() -> &'static str {
    r#"# 🌼 花笺的云端抽屉

> 嘘——这里住着几台设备共同养的一叠电子花笺。

这个仓库由 **花笺（Floral Notepaper）** 自动打理。它不会要求你的电脑安装 Git，也不会把 GitHub 访问令牌写进仓库；软件只是偶尔打开抽屉，放进新纸条，再把别处写好的纸条带回来。

## 抽屉里有什么？

- `workspaces/`：总抽屉；每个本地文件夹在这里拥有一格独立空间。
- `workspaces/工作区名/`：某个工作区的 Markdown、分类文件夹和图片。
- `workspaces/工作区名/manifest.json`：花笺用来辨认顺序、文件夹和版本的小地图。
- `README.md`：就是你正在看的这张门牌，放心改，花笺不会覆盖它。

例如：

```text
workspaces/
├─ 论文资料/
│  ├─ 文献调研/蓝牙攻击检测.md
│  ├─ 随手记.md
│  ├─ images/
│  └─ manifest.json
└─ 工作记录/
   └─ ...
```

## 与抽屉相处的三条小规矩

1. 日常编辑请在花笺里完成，`workspaces/` 下的文件尽量别手动挪动。
2. 两台设备同时改同一篇也不用慌：花笺会保留双方，并生成一篇“同步冲突副本”供你慢慢挑。
3. 不同工作区彼此隔离；同步某一格时，不会碰旁边工作区的纸条。

## 新设备入住

先在新设备上打开一个空的本地文件夹，再进入「设置 → GitHub 同步」，填入仓库地址、`main` 分支和具有 **Contents: Read and write** 权限的访问令牌。点击「读取云端」，选择要搬回来的工作区，再点击「下载云端」。这个按钮只读取 GitHub，不会上传或删除云端文件；确认下载完成后，再按需要启用日常双向同步。

---

今天也请随手写下一点什么。空白纸张不会催你，但它一直在等你。🐾
"#
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str, content: &str) -> SnapshotNote {
        let now = Utc::now();
        let note = Note {
            id: id.into(),
            title: id.into(),
            file_name: format!("{id}.md"),
            category: String::new(),
            created_at: now,
            updated_at: now,
            word_count: 0,
            content: content.into(),
            document_kind: DocumentKind::Markdown,
            original_file_name: None,
            local_only: false,
            original_local_only: false,
            binary_data: None,
        };
        let content_hash = hash_bytes(content.as_bytes());
        let record_hash = note_record_hash(&note, &content_hash);
        SnapshotNote {
            note,
            content_hash,
            record_hash,
            blob_sha: String::new(),
        }
    }

    fn manifest_note(id: &str, title: &str, file_name: &str, category: &str) -> ManifestNote {
        ManifestNote {
            id: id.into(),
            title: title.into(),
            file_name: file_name.into(),
            category: category.into(),
            path: String::new(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            content_hash: String::new(),
            record_hash: String::new(),
            blob_sha: "blob".into(),
            document_kind: DocumentKind::Markdown,
            original_file_name: None,
            original_local_only: false,
        }
    }

    fn settings(workspace_name: &str) -> GitSyncSettings {
        GitSyncSettings {
            repository_url: "https://github.com/example/floral-sync.git".into(),
            branch: "main".into(),
            workspace_name: workspace_name.into(),
            ..GitSyncSettings::default()
        }
    }

    #[test]
    fn parses_supported_repository_urls() {
        assert_eq!(
            parse_repository("https://github.com/ly20030823/floral-notepaper-sync.git").unwrap(),
            ("ly20030823".into(), "floral-notepaper-sync".into())
        );
        assert!(parse_repository("https://gitee.com/a/b").is_err());
    }

    #[test]
    fn maps_workspaces_and_categories_to_distinct_readable_repository_folders() {
        let root = workspace_repo_root("科研资料");
        assert_eq!(
            note_repo_path(
                &root,
                &manifest_note("note-one", "论文", "论文.md", "文献调研")
            ),
            "workspaces/科研资料/文献调研/论文.md"
        );
        assert_eq!(
            note_repo_path(
                &root,
                &manifest_note("note-two", "计划", "计划.md", "项目记录")
            ),
            "workspaces/科研资料/项目记录/计划.md"
        );
        assert_eq!(
            note_repo_path(
                &root,
                &manifest_note("note-three", "随手记", "随手记.md", "")
            ),
            "workspaces/科研资料/随手记.md"
        );
        assert_ne!(
            note_repo_path(
                &workspace_repo_root("科研资料"),
                &manifest_note("note-four", "同名", "同名.md", "")
            ),
            note_repo_path(
                &workspace_repo_root("生活记录"),
                &manifest_note("note-four", "同名", "同名.md", "")
            )
        );
    }

    #[test]
    fn discovers_only_direct_workspace_manifests() {
        assert_eq!(
            workspace_folder_from_manifest_path("workspaces/论文资料/manifest.json"),
            Some("论文资料")
        );
        assert_eq!(
            workspace_folder_from_manifest_path("workspaces/生活记录/manifest.json"),
            Some("生活记录")
        );
        assert_eq!(
            workspace_folder_from_manifest_path("workspaces/论文资料/归档/manifest.json"),
            None
        );
        assert_eq!(workspace_folder_from_manifest_path("data/manifest.json"), None);
    }

    #[test]
    fn workspace_state_files_are_isolated() {
        let root = Path::new("config");
        let first_settings = settings("论文资料");
        let second_settings = settings("工作记录");
        assert_ne!(
            state_path(root, Path::new("D:/notes/research"), &first_settings),
            state_path(root, Path::new("D:/notes/research"), &second_settings)
        );
        assert_ne!(
            state_path(root, Path::new("D:/notes/research"), &first_settings),
            state_path(root, Path::new("D:/notes/empty-copy"), &first_settings)
        );
    }

    #[test]
    fn first_legacy_migration_reuses_previous_sync_baseline() {
        let root = std::env::temp_dir().join(format!("floral-sync-state-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create sync state directory");
        let legacy = SyncState {
            note_hashes: BTreeMap::from([("note-one".into(), "previous-hash".into())]),
            last_sync_at: Some(Utc::now()),
            ..SyncState::default()
        };
        write_json_atomic(&root.join(LEGACY_STATE_FILE), &legacy).expect("write legacy state");

        let data_dir = root.join("workspace");
        fs::create_dir_all(&data_dir).expect("create workspace");
        let settings = settings("论文资料");
        let loaded = load_state_for_sync(&root, &data_dir, &settings, true)
            .expect("load legacy sync baseline");
        assert_eq!(loaded.workspace_name, "论文资料");
        assert_eq!(
            loaded.note_hashes.get("note-one").map(String::as_str),
            Some("previous-hash")
        );
        fs::remove_dir_all(root).expect("remove sync state directory");
    }

    #[test]
    fn protects_remote_notes_when_a_previously_synced_local_folder_is_empty() {
        let remote_note = note("one", "cloud copy");
        let remote = BTreeMap::from([("one".into(), remote_note.clone())]);
        let base = BTreeMap::from([("one".into(), remote_note.record_hash)]);

        assert!(should_protect_remote_from_empty_local(
            &BTreeMap::new(),
            &remote,
            &base
        ));
        assert!(!should_protect_remote_from_empty_local(
            &BTreeMap::new(),
            &remote,
            &BTreeMap::new()
        ));
    }

    #[test]
    fn cloud_download_only_accepts_an_empty_local_workspace() {
        assert!(ensure_download_target_is_empty(&BTreeMap::new()).is_ok());

        let local = BTreeMap::from([("one".into(), note("one", "local content"))]);
        let error = ensure_download_target_is_empty(&local).expect_err("reject non-empty local");
        assert_eq!(error.code, "syncDownloadLocalNotEmpty");
        assert!(error.message.contains("1 篇笔记"));
    }

    #[test]
    fn legacy_manifest_notes_keep_their_flat_path_until_migrated() {
        let now = Utc::now();
        let entry = ManifestNote {
            id: "legacy-note".into(),
            title: "旧笔记".into(),
            file_name: String::new(),
            category: "旧文件夹".into(),
            path: String::new(),
            created_at: now,
            updated_at: now,
            content_hash: String::new(),
            record_hash: String::new(),
            blob_sha: "blob".into(),
            document_kind: DocumentKind::Markdown,
            original_file_name: None,
            original_local_only: false,
        };
        assert_eq!(
            manifest_note_repo_path(&entry, "workspaces/当前工作区", true).unwrap(),
            "data/notes/legacy-note.md"
        );
        assert_ne!(
            manifest_note_repo_path(&entry, "workspaces/当前工作区", true).unwrap(),
            manifest_note_repo_path(&entry, "workspaces/当前工作区", false).unwrap()
        );
    }

    #[test]
    fn rejects_unsafe_manifest_note_paths() {
        let now = Utc::now();
        let entry = ManifestNote {
            id: "unsafe-note".into(),
            title: "不安全路径".into(),
            file_name: "不安全路径.md".into(),
            category: String::new(),
            path: "data/notes/../../README.md".into(),
            created_at: now,
            updated_at: now,
            content_hash: String::new(),
            record_hash: String::new(),
            blob_sha: "blob".into(),
            document_kind: DocumentKind::Markdown,
            original_file_name: None,
            original_local_only: false,
        };
        assert!(
            manifest_note_repo_path(&entry, "workspaces/当前工作区", false).is_err()
        );
    }

    #[test]
    fn remote_change_wins_when_local_is_base() {
        let left = note("one", "old");
        let right = note("one", "new");
        let local = BTreeMap::from([("one".into(), left.clone())]);
        let remote = BTreeMap::from([("one".into(), right.clone())]);
        let base = BTreeMap::from([("one".into(), left.record_hash)]);
        let (merged, conflicts, _) = merge_notes(&local, &remote, &base);
        assert_eq!(merged["one"].note.content, "new");
        assert_eq!(conflicts, 0);
    }

    #[test]
    fn simultaneous_changes_create_conflict_copy() {
        let left = note("one", "left");
        let right = note("one", "right");
        let local = BTreeMap::from([("one".into(), left)]);
        let remote = BTreeMap::from([("one".into(), right)]);
        let (merged, conflicts, _) = merge_notes(&local, &remote, &BTreeMap::new());
        assert_eq!(merged.len(), 2);
        assert_eq!(conflicts, 1);
    }
}
