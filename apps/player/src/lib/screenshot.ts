import type { RoomKitClient } from '@roomkit/client';
import { SCREENSHOT_MAX_CHARS, type DeviceScreenshotReport } from '@roomkit/shared';
import { vlog } from './log';
import { isTauri } from './tauri';

/** How often a stage window reports its capture while attached to a session. */
export const SCREENSHOT_INTERVAL_MS = 5000;
/** Reported width (CSS px); studio shows a thumbnail and a click-to-enlarge view. */
const CAPTURE_WIDTH = 960;
const JPEG_QUALITY = 0.7;

/**
 * Snapshot this webview through the native webview API (no screen-recording
 * permission; see src-tauri/src/screenshot.rs), then downscale/re-encode to a
 * JPEG data URL that fits the protocol's size cap. Null in the browser dev
 * harness or when the result cannot be made small enough.
 */
export async function captureStage(): Promise<DeviceScreenshotReport | null> {
	if (!isTauri()) return null;
	const { invoke } = await import('@tauri-apps/api/core');
	const bytes = await invoke<ArrayBuffer>('capture_webview', { maxWidth: CAPTURE_WIDTH });
	const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
	try {
		const scale = Math.min(1, CAPTURE_WIDTH / bitmap.width);
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) return null;
		ctx.drawImage(bitmap, 0, 0, width, height);
		let quality = JPEG_QUALITY;
		let image = canvas.toDataURL('image/jpeg', quality);
		// Busy frames compress worse; trade quality before giving up.
		while (image.length > SCREENSHOT_MAX_CHARS && quality > 0.35) {
			quality -= 0.15;
			image = canvas.toDataURL('image/jpeg', quality);
		}
		if (image.length > SCREENSHOT_MAX_CHARS) return null;
		return { image, width, height };
	} finally {
		bitmap.close();
	}
}

/**
 * Periodically capture and report while `shouldCapture()` holds (typically:
 * the device socket is connected). Captures never overlap; failures are
 * logged once per streak so an unsupported platform stays quiet.
 */
export function startScreenshotReporter(
	client: RoomKitClient,
	shouldCapture: () => boolean
): () => void {
	if (!isTauri()) return () => {};
	let busy = false;
	let failed = false;
	const tick = async () => {
		if (busy || document.hidden || !shouldCapture()) return;
		busy = true;
		try {
			const report = await captureStage();
			if (report) client.reportScreenshot(report);
			failed = false;
		} catch (error) {
			if (!failed) vlog('screenshot', 'capture failed', error);
			failed = true;
		} finally {
			busy = false;
		}
	};
	const timer = setInterval(() => void tick(), SCREENSHOT_INTERVAL_MS);
	void tick();
	return () => clearInterval(timer);
}
