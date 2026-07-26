use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

/// Media cache under `<app data>/cache/<fileKey>`. fileKeys are immutable
/// S3-style keys (`themes/<id>/<uuid>/<name>`), so file presence == fresh.
///
/// Several webviews (launcher + one window per device) call these commands
/// concurrently against ONE cache directory, so downloads are coordinated
/// process-wide: a per-key active set makes the second window wait instead of
/// truncating the first one's `.part`, and list/prune leave an active key's
/// files alone.

const PROGRESS_EMIT_STEP: u64 = 1024 * 1024;

/// Keys with a download in flight (any window).
fn active_downloads() -> &'static Mutex<HashSet<String>> {
  static ACTIVE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
  ACTIVE.get_or_init(|| Mutex::new(HashSet::new()))
}

fn is_active(key: &str) -> bool {
  active_downloads().lock().unwrap().contains(key)
}

/// Removes the key from the active set when the download ends — every exit
/// path included (errors, early returns).
struct ActiveGuard(String);

impl Drop for ActiveGuard {
  fn drop(&mut self) {
    active_downloads().lock().unwrap().remove(&self.0);
  }
}

fn try_claim(key: &str) -> Option<ActiveGuard> {
  let mut set = active_downloads().lock().unwrap();
  if set.contains(key) {
    return None;
  }
  set.insert(key.to_string());
  Some(ActiveGuard(key.to_string()))
}

pub(crate) fn cache_base(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?
    .join("cache");
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

/// Joins a fileKey under the cache root, rejecting traversal segments.
fn safe_join(root: &Path, file_key: &str) -> Result<PathBuf, String> {
  let rel = Path::new(file_key);
  let plain = rel
    .components()
    .all(|c| matches!(c, Component::Normal(_)));
  if file_key.is_empty() || rel.is_absolute() || !plain {
    return Err(format!("invalid file key: {file_key}"));
  }
  Ok(root.join(rel))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheProgress<'a> {
  file_key: &'a str,
  received: u64,
  total: Option<u64>,
}

#[tauri::command]
pub async fn cache_download(
  app: AppHandle,
  file_key: String,
  url: String,
) -> Result<(), String> {
  let root = cache_base(&app)?;
  let dest = safe_join(&root, &file_key)?;
  // Claim the key or wait for the window that already downloads it — two
  // windows writing the same `.part` truncate each other into a corrupt file.
  let _guard = loop {
    if dest.exists() {
      return Ok(());
    }
    match try_claim(&file_key) {
      Some(guard) => break guard,
      None => tokio::time::sleep(Duration::from_millis(250)).await,
    }
  };
  if dest.exists() {
    return Ok(());
  }
  if let Some(parent) = dest.parent() {
    tokio::fs::create_dir_all(parent)
      .await
      .map_err(|e| e.to_string())?;
  }

  let resp = reqwest::get(&url).await.map_err(|e| e.to_string())?;
  if !resp.status().is_success() {
    return Err(format!("download failed with status {}", resp.status()));
  }
  let total = resp.content_length();

  // .part + atomic rename: a crashed download never poisons the cache.
  let part = dest.with_file_name(format!(
    "{}.part",
    dest
      .file_name()
      .and_then(|n| n.to_str())
      .ok_or("invalid file name")?
  ));
  let mut file = tokio::fs::File::create(&part)
    .await
    .map_err(|e| e.to_string())?;
  let mut stream = resp.bytes_stream();
  let mut received: u64 = 0;
  let mut last_emit: u64 = 0;
  while let Some(chunk) = stream.next().await {
    let chunk = chunk.map_err(|e| e.to_string())?;
    file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    received += chunk.len() as u64;
    if received - last_emit >= PROGRESS_EMIT_STEP {
      last_emit = received;
      let _ = app.emit(
        "cache:progress",
        CacheProgress {
          file_key: &file_key,
          received,
          total,
        },
      );
    }
  }
  file.flush().await.map_err(|e| e.to_string())?;
  drop(file);
  tokio::fs::rename(&part, &dest)
    .await
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
pub fn cache_list(app: AppHandle) -> Result<Vec<String>, String> {
  let root = cache_base(&app)?;
  let mut keys = Vec::new();
  collect_files(&root, &root, &mut keys)?;
  Ok(keys)
}

/// Deletes cached files that are not in `keep` (and stale .part leftovers),
/// then removes empty directories. Returns the number of files deleted.
#[tauri::command]
pub fn cache_prune(app: AppHandle, keep: Vec<String>) -> Result<u32, String> {
  let root = cache_base(&app)?;
  let keep: std::collections::HashSet<&str> = keep.iter().map(String::as_str).collect();
  let mut existing = Vec::new();
  collect_files(&root, &root, &mut existing)?;
  let mut deleted = 0u32;
  for key in existing {
    // Another window may be mid-download for a manifest this window has not
    // seen (e.g. right after a theme re-import) — leave its file alone.
    if !keep.contains(key.as_str()) && !is_active(&key) {
      if std::fs::remove_file(root.join(&key)).is_ok() {
        deleted += 1;
      }
    }
  }
  remove_empty_dirs(&root, &root)?;
  Ok(deleted)
}

/// Cached file contents for the webview. Delegated video ships them to the
/// claiming https site as a Blob over postMessage — such pages cannot load
/// the loopback media server (WebKit blocks mixed content even from
/// 127.0.0.1).
#[tauri::command]
pub async fn cache_read(app: AppHandle, file_key: String) -> Result<tauri::ipc::Response, String> {
  let root = cache_base(&app)?;
  let path = safe_join(&root, &file_key)?;
  let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
  Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn cache_root(app: AppHandle) -> Result<String, String> {
  Ok(cache_base(&app)?.to_string_lossy().into_owned())
}

fn collect_files(root: &Path, dir: &Path, out: &mut Vec<String>) -> Result<(), String> {
  for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let path = entry.path();
    if path.is_dir() {
      collect_files(root, &path, out)?;
    } else if path.extension().and_then(|e| e.to_str()) == Some("part") {
      // Leftover from a crashed download; treat as garbage — unless a window
      // is writing it right now (deleting a live .part fails its rename).
      let live = path
        .with_extension("")
        .strip_prefix(root)
        .ok()
        .and_then(|rel| {
          let key = rel
            .components()
            .filter_map(|c| c.as_os_str().to_str())
            .collect::<Vec<_>>()
            .join("/");
          Some(is_active(&key))
        })
        .unwrap_or(false);
      if !live {
        let _ = std::fs::remove_file(&path);
      }
    } else if let Ok(rel) = path.strip_prefix(root) {
      // Cache keys always use forward slashes, also on Windows.
      let key = rel
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect::<Vec<_>>()
        .join("/");
      out.push(key);
    }
  }
  Ok(())
}

fn remove_empty_dirs(root: &Path, dir: &Path) -> Result<bool, String> {
  let mut empty = true;
  for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
    let entry = entry.map_err(|e| e.to_string())?;
    let path = entry.path();
    if path.is_dir() {
      if remove_empty_dirs(root, &path)? {
        let _ = std::fs::remove_dir(&path);
      } else {
        empty = false;
      }
    } else {
      empty = false;
    }
  }
  Ok(empty && dir != root)
}
