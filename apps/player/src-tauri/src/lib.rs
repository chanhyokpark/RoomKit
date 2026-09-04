mod cache;
mod media_server;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // All webviews share one WebView2 environment (keyed to the user data
  // folder), and environment creation fails when webviews disagree on browser
  // arguments — a per-window `additionalBrowserArgs` in tauri.conf.json made
  // every JS-opened window (test/debug/device) close instantly on Windows.
  // Apply the autoplay policy process-wide instead so every webview matches.
  #[cfg(target_os = "windows")]
  if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
    std::env::set_var(
      "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
      "--autoplay-policy=no-user-gesture-required",
    );
  }
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_os::init())
    // Vibration/haptic feedback relayed from helper sites (mobile only; the
    // desktop implementation is a no-op).
    .plugin(tauri_plugin_haptics::init())
    .invoke_handler(tauri::generate_handler![
      cache::cache_download,
      cache::cache_list,
      cache::cache_prune,
      cache::cache_read,
      cache::cache_root,
      media_server::media_server_port
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Best-effort: without the media server the player still works, it just
      // streams delegated video from presigned URLs instead of the cache.
      let port = cache::cache_base(app.handle())
        .and_then(|root| tauri::async_runtime::block_on(media_server::start(root)));
      let port = match port {
        Ok(port) => Some(port),
        Err(e) => {
          eprintln!("[media server] failed to start: {e}");
          None
        }
      };
      app.manage(media_server::MediaServer { port });
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
