//! Keeps the display on while a stage is showing. Stage windows hold a Screen
//! Wake Lock from JS (see `src/lib/wake-lock.ts`); WKWebView on iOS does not
//! reliably offer that API, so there the app also switches off the system
//! idle timer. Every other platform relies on the web API alone.

use tauri::{AppHandle, Runtime};

#[tauri::command]
pub fn keep_awake<R: Runtime>(app: AppHandle<R>, on: bool) -> Result<(), String> {
  #[cfg(target_os = "ios")]
  {
    app
      .run_on_main_thread(move || {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        // SAFETY: UIApplication is main-thread only, which is where this runs.
        unsafe {
          let application: *mut AnyObject = msg_send![class!(UIApplication), sharedApplication];
          if !application.is_null() {
            let _: () = msg_send![application, setIdleTimerDisabled: on];
          }
        }
      })
      .map_err(|e| e.to_string())
  }
  #[cfg(not(target_os = "ios"))]
  {
    let _ = (app, on);
    Ok(())
  }
}
