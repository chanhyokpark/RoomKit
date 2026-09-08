//! Stage screenshots without OS-level screen-capture permissions.
//!
//! Instead of grabbing the screen (macOS Screen Recording TCC, Android
//! MediaProjection), the webview renders its own layer tree into an image:
//! WKWebView `takeSnapshot`, WebView2 `CapturePreview`, and on Android a
//! `PixelCopy` of the WebView's window rect (see `ScreenshotPlugin.kt`).
//! Cross-origin helper iframes and `<video>` are included since they are part
//! of the same webview. The command returns encoded image bytes (PNG); the
//! frontend downscales/re-encodes and ships the result to the server.

use tauri::{ipc::Response, Runtime, Webview};

/// Android bridge to `app.roomkit.player.ScreenshotPlugin` (see the plugin
/// registration in [`init`]). Managed state; absent on other platforms.
#[cfg(target_os = "android")]
pub struct ScreenshotPlugin<R: Runtime>(tauri::plugin::PluginHandle<R>);

/// Tauri plugin whose only job is registering the Android side.
pub fn init<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
  tauri::plugin::Builder::new("roomkit-screenshot")
    .setup(|app, api| {
      #[cfg(target_os = "android")]
      {
        use tauri::Manager;
        let handle = api.register_android_plugin("app.roomkit.player", "ScreenshotPlugin")?;
        app.manage(ScreenshotPlugin(handle));
      }
      #[cfg(not(target_os = "android"))]
      let _ = (app, api);
      Ok(())
    })
    .build()
}

/// Capture the calling webview. `max_width` (CSS px) lets the platform
/// downscale early where it can (macOS, Android); the frontend clamps again.
#[tauri::command]
pub async fn capture_webview<R: Runtime>(
  webview: Webview<R>,
  max_width: Option<u32>,
) -> Result<Response, String> {
  let bytes = capture(&webview, max_width).await?;
  Ok(Response::new(bytes))
}

#[cfg(target_os = "macos")]
async fn capture<R: Runtime>(webview: &Webview<R>, max_width: Option<u32>) -> Result<Vec<u8>, String> {
  let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
  webview
    .with_webview(move |platform| {
      let result = macos::snapshot(platform, max_width, tx);
      if let Err((tx, message)) = result {
        let _ = tx.send(Err(message));
      }
    })
    .map_err(|e| e.to_string())?;
  rx.await.map_err(|_| "snapshot callback dropped".to_string())?
}

#[cfg(target_os = "macos")]
mod macos {
  use block2::RcBlock;
  use objc2::MainThreadMarker;
  use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
  use objc2_foundation::{NSDictionary, NSError, NSNumber};
  use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
  use std::sync::Mutex;
  use tauri::webview::PlatformWebview;
  use tokio::sync::oneshot::Sender;

  type Reply = Sender<Result<Vec<u8>, String>>;

  /// Runs on the main thread (guaranteed by `with_webview`). The completion
  /// block fires later on the main thread and answers through `tx`.
  pub fn snapshot(
    platform: PlatformWebview,
    max_width: Option<u32>,
    tx: Reply,
  ) -> Result<(), (Reply, String)> {
    let Some(mtm) = MainThreadMarker::new() else {
      return Err((tx, "snapshot must run on the main thread".into()));
    };
    let ptr = platform.inner() as *const WKWebView;
    if ptr.is_null() {
      return Err((tx, "no WKWebView handle".into()));
    }
    // SAFETY: tauri hands us the live WKWebView of this webview; we only use
    // it synchronously on the main thread.
    let wk: &WKWebView = unsafe { &*ptr };
    let config = unsafe { WKSnapshotConfiguration::new(mtm) };
    if let Some(width) = max_width {
      unsafe { config.setSnapshotWidth(Some(&NSNumber::numberWithUnsignedInt(width))) };
    }
    let tx = Mutex::new(Some(tx));
    let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
      let result = if image.is_null() {
        Err(if error.is_null() {
          "snapshot failed".to_string()
        } else {
          unsafe { (*error).localizedDescription().to_string() }
        })
      } else {
        unsafe { png_bytes(&*image) }
      };
      if let Some(tx) = tx.lock().ok().and_then(|mut slot| slot.take()) {
        let _ = tx.send(result);
      }
    });
    unsafe { wk.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler) };
    Ok(())
  }

  unsafe fn png_bytes(image: &NSImage) -> Result<Vec<u8>, String> {
    let tiff = image.TIFFRepresentation().ok_or("snapshot has no bitmap")?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("cannot read snapshot bitmap")?;
    let png = rep
      .representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
      .ok_or("PNG encoding failed")?;
    Ok(png.to_vec())
  }
}

#[cfg(windows)]
async fn capture<R: Runtime>(webview: &Webview<R>, _max_width: Option<u32>) -> Result<Vec<u8>, String> {
  let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
  webview
    .with_webview(move |platform| {
      let result = win::snapshot(platform, tx);
      if let Err((tx, message)) = result {
        let _ = tx.send(Err(message));
      }
    })
    .map_err(|e| e.to_string())?;
  rx.await.map_err(|_| "snapshot callback dropped".to_string())?
}

// NOTE: written against webview2-com 0.38 / windows 0.61 but not compiled on
// a Windows host yet — verify with `cargo check` there before shipping.
#[cfg(windows)]
mod win {
  use tauri::webview::PlatformWebview;
  use tokio::sync::oneshot::Sender;
  use webview2_com::CapturePreviewCompletedHandler;
  use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
  use windows::Win32::System::Com::{IStream, STREAM_SEEK_SET};
  use windows::Win32::UI::Shell::SHCreateMemStream;

  type Reply = Sender<Result<Vec<u8>, String>>;

  pub fn snapshot(platform: PlatformWebview, tx: Reply) -> Result<(), (Reply, String)> {
    let core = match unsafe { platform.controller().CoreWebView2() } {
      Ok(core) => core,
      Err(e) => return Err((tx, e.to_string())),
    };
    let Some(stream) = (unsafe { SHCreateMemStream(None) }) else {
      return Err((tx, "cannot allocate memory stream".into()));
    };
    let read_stream = stream.clone();
    let handler = CapturePreviewCompletedHandler::create(Box::new(move |hr| {
      let result = if hr.is_ok() {
        read_all(&read_stream)
      } else {
        Err(format!("CapturePreview failed: {hr}"))
      };
      let _ = tx.send(result);
      Ok(())
    }));
    if let Err(e) =
      unsafe { core.CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler) }
    {
      // The handler (and its sender) is dropped here, which fails the await.
      return Err((
        tokio::sync::oneshot::channel().0,
        format!("CapturePreview call failed: {e}"),
      ));
    }
    Ok(())
  }

  fn read_all(stream: &IStream) -> Result<Vec<u8>, String> {
    unsafe { stream.Seek(0, STREAM_SEEK_SET, None) }.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    loop {
      let mut read = 0u32;
      let hr = unsafe { stream.Read(chunk.as_mut_ptr().cast(), chunk.len() as u32, Some(&mut read)) };
      if hr.is_err() {
        return Err(format!("stream read failed: {hr}"));
      }
      if read == 0 {
        break;
      }
      out.extend_from_slice(&chunk[..read as usize]);
    }
    Ok(out)
  }
}

#[cfg(target_os = "android")]
async fn capture<R: Runtime>(webview: &Webview<R>, max_width: Option<u32>) -> Result<Vec<u8>, String> {
  use base64::Engine;
  use tauri::Manager;

  #[derive(serde::Serialize)]
  #[serde(rename_all = "camelCase")]
  struct Args {
    max_width: Option<u32>,
  }
  #[derive(serde::Deserialize)]
  struct Reply {
    data: String,
  }

  let plugin = webview.state::<ScreenshotPlugin<R>>();
  let reply: Reply = plugin
    .0
    .run_mobile_plugin_async("capture", Args { max_width })
    .await
    .map_err(|e| e.to_string())?;
  base64::engine::general_purpose::STANDARD
    .decode(reply.data)
    .map_err(|e| format!("invalid screenshot payload: {e}"))
}

#[cfg(not(any(target_os = "macos", windows, target_os = "android")))]
async fn capture<R: Runtime>(_webview: &Webview<R>, _max_width: Option<u32>) -> Result<Vec<u8>, String> {
  Err("screenshots are not supported on this platform".into())
}
