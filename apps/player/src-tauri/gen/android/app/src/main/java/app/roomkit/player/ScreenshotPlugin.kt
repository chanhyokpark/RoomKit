package app.roomkit.player

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.view.PixelCopy
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream

@InvokeArg
class CaptureArgs {
  /** Target width in CSS px; the capture is downscaled to fit. */
  var maxWidth: Int? = null
}

/**
 * In-app Tauri plugin backing the `capture_webview` command (src/screenshot.rs).
 * Copies the WebView's pixels straight from the window surface with
 * `PixelCopy` — no MediaProjection prompt, and hardware-composited content
 * (video, helper iframes) is included. Resolves `{ data, width, height }` with
 * a base64 PNG.
 */
@TauriPlugin
class ScreenshotPlugin(private val activity: Activity) : Plugin(activity) {
  private var webView: WebView? = null
  private val worker = HandlerThread("roomkit-screenshot").apply { start() }
  private val workerHandler = Handler(worker.looper)

  override fun load(webView: WebView) {
    this.webView = webView
  }

  @Command
  fun capture(invoke: Invoke) {
    val args = invoke.parseArgs(CaptureArgs::class.java)
    val view = webView
    if (view == null) {
      invoke.reject("webview not loaded")
      return
    }
    activity.runOnUiThread {
      val width = view.width
      val height = view.height
      if (width <= 0 || height <= 0) {
        invoke.reject("webview has no size")
        return@runOnUiThread
      }
      val maxWidth = args.maxWidth
      val scale = if (maxWidth != null && maxWidth in 1 until width) maxWidth.toFloat() / width else 1f
      val outWidth = (width * scale).toInt().coerceAtLeast(1)
      val outHeight = (height * scale).toInt().coerceAtLeast(1)
      val bitmap = Bitmap.createBitmap(outWidth, outHeight, Bitmap.Config.ARGB_8888)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val location = IntArray(2)
        view.getLocationInWindow(location)
        val rect = Rect(location[0], location[1], location[0] + width, location[1] + height)
        try {
          // PixelCopy scales into the (smaller) destination bitmap itself.
          PixelCopy.request(activity.window, rect, bitmap, { result ->
            if (result == PixelCopy.SUCCESS) {
              encode(invoke, bitmap)
            } else {
              bitmap.recycle()
              invoke.reject("PixelCopy failed: $result")
            }
          }, workerHandler)
        } catch (e: Exception) {
          bitmap.recycle()
          invoke.reject("PixelCopy error: ${e.message}")
        }
      } else {
        // API 24/25 fallback: software draw (misses video and other hardware layers).
        val canvas = Canvas(bitmap)
        canvas.scale(scale, scale)
        view.draw(canvas)
        encode(invoke, bitmap)
      }
    }
  }

  /** PNG-encode off the UI thread and answer the invoke. Recycles `bitmap`. */
  private fun encode(invoke: Invoke, bitmap: Bitmap) {
    workerHandler.post {
      try {
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
        val result = JSObject()
        result.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
        result.put("width", bitmap.width)
        result.put("height", bitmap.height)
        invoke.resolve(result)
      } catch (e: Exception) {
        invoke.reject("PNG encoding failed: ${e.message}")
      } finally {
        bitmap.recycle()
      }
    }
  }
}
