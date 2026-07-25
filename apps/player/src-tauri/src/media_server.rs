use std::net::Ipv4Addr;
use std::path::PathBuf;

use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

/// Loopback HTTP server exposing the media cache read-only. Cross-origin
/// helper iframes cannot load `asset://` URLs, but they can load
/// `http://127.0.0.1:<port>/<fileKey>` — this is how delegated video plays
/// from cache. ServeDir handles Range requests (video seeking) and rejects
/// path traversal; CORS is permissive so fetch-based site players work too.
pub struct MediaServer {
  /// None when the server failed to start; clients fall back to presigned URLs.
  pub port: Option<u16>,
}

pub async fn start(cache_root: PathBuf) -> Result<u16, String> {
  let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
    .await
    .map_err(|e| e.to_string())?;
  let port = listener.local_addr().map_err(|e| e.to_string())?.port();
  let router = axum::Router::new()
    .fallback_service(ServeDir::new(cache_root))
    .layer(CorsLayer::permissive());
  tauri::async_runtime::spawn(async move {
    if let Err(e) = axum::serve(listener, router).await {
      eprintln!("[media server] stopped: {e}");
    }
  });
  Ok(port)
}

#[tauri::command]
pub fn media_server_port(state: tauri::State<'_, MediaServer>) -> Option<u16> {
  state.port
}
