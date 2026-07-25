use std::path::{Component, Path, PathBuf};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

/// Media cache under `<app data>/cache/<fileKey>`. fileKeys are immutable
/// S3-style keys (`themes/<id>/<uuid>/<name>`), so file presence == fresh.

const PROGRESS_EMIT_STEP: u64 = 1024 * 1024;

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
    if !keep.contains(key.as_str()) {
      if std::fs::remove_file(root.join(&key)).is_ok() {
        deleted += 1;
      }
    }
  }
  remove_empty_dirs(&root, &root)?;
  Ok(deleted)
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
      // Leftover from a crashed download; treat as garbage.
      let _ = std::fs::remove_file(&path);
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
