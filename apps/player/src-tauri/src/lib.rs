mod cache;
mod media_server;
mod screenshot;

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
  let builder = tauri::Builder::default();
  // Must be the first plugin: on Windows/Linux an app link starts a second
  // process, and single-instance hands its argv (the URL) to this one, which
  // the deep-link plugin then emits as `deep-link://new-url`.
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
    if let Some(window) = app.get_webview_window("main") {
      let _ = window.unminimize();
      let _ = window.set_focus();
    }
  }));
  builder
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_os::init())
    // Vibration/haptic feedback relayed from helper sites (mobile only; the
    // desktop implementation is a no-op).
    .plugin(tauri_plugin_haptics::init())
    .plugin(screenshot::init())
    .invoke_handler(tauri::generate_handler![
      cache::cache_download,
      cache::cache_list,
      cache::cache_prune,
      cache::cache_read,
      cache::cache_root,
      media_server::media_server_port,
      screenshot::capture_webview
    ])
    .setup(|app| {
      // Installers register the scheme (macOS: Info.plist, Windows/Linux:
      // registry / .desktop). `tauri dev` has no installer, so register at
      // runtime where the OS allows it — macOS only honours the bundle.
      #[cfg(any(windows, target_os = "linux"))]
      {
        use tauri_plugin_deep_link::DeepLinkExt;
        if let Err(e) = app.deep_link().register_all() {
          eprintln!("[deep-link] register failed: {e}");
        }
      }
      // Every window's JS forwards its console/app logs here (see
      // src/lib/log.ts): stdout in dev, and a rotating file in the app log
      // dir for post-mortems. Operators read the same lines in the session
      // dashboard — stage windows upload them over the device socket.
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .clear_targets()
          .targets([
            #[cfg(desktop)]
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
              file_name: Some("player".into()),
            }),
          ])
          .level(if cfg!(debug_assertions) {
            log::LevelFilter::Debug
          } else {
            log::LevelFilter::Info
          })
          .max_file_size(4_000_000)
          .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
          .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
          // JS lines already carry their window label; keep the Rust
          // target only for records that come from native code.
          .format(|out, message, record| {
            const TIME_FORMAT: &[time::format_description::BorrowedFormatItem<'_>] =
              time::macros::format_description!("[hour]:[minute]:[second].[subsecond digits:3]");
            let target = record.target();
            let time = tauri_plugin_log::TimezoneStrategy::UseLocal
              .get_now()
              .format(TIME_FORMAT)
              .unwrap_or_default();
            if target.starts_with("webview") {
              out.finish(format_args!("{time} [{}] {message}", record.level()))
            } else {
              out.finish(format_args!("{time} [{}][{target}] {message}", record.level()))
            }
          })
          .build(),
      )?;
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
