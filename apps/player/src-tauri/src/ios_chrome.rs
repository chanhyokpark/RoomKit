//! iOS system chrome. A stage is a kiosk surface, so the status bar (clock,
//! battery) is hidden and the home indicator fades out when idle. Tauri has
//! no setting for either; tao's view controller does, so it is told directly.

use tauri::{Runtime, Webview};

/// Idempotent; called on every page load since the single mobile webview
/// navigates in place between launcher and stage.
pub fn hide<R: Runtime>(webview: &Webview<R>) {
  let _ = webview.with_webview(|platform| {
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};

    let controller = platform.view_controller() as *mut AnyObject;
    if controller.is_null() {
      return;
    }
    // SAFETY: runs on the main thread with the webview's live view
    // controller; the selectors are checked before use.
    unsafe {
      let responds: bool = msg_send![controller, respondsToSelector: sel!(setPrefersStatusBarHidden:)];
      if responds {
        let _: () = msg_send![controller, setPrefersStatusBarHidden: true];
      }
      let responds: bool =
        msg_send![controller, respondsToSelector: sel!(setPrefersHomeIndicatorAutoHidden:)];
      if responds {
        let _: () = msg_send![controller, setPrefersHomeIndicatorAutoHidden: true];
      }
    }
  });
}
