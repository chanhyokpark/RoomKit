import { vlog } from './log';
import { isMobile, isTauri } from './tauri';
import type { DeviceEntry } from './stores/config.svelte';

let mobileNavigated = false;

/**
 * Mobile builds host a single webview, so "opening a window" means navigating
 * the launcher itself to the stage URL. One-shot: extra opens in the same
 * batch (multi-device test start, "open all") are dropped — only one stage can
 * exist, and the user closes the app to get back to the launcher.
 */
async function navigateSingleWindow(query: string): Promise<boolean> {
	if (!(await isMobile())) return false;
	if (mobileNavigated) {
		vlog('windows', 'single-window mode: dropping extra open', query);
		return true;
	}
	mobileNavigated = true;
	const url = new URL(window.location.href);
	url.search = query;
	vlog('windows', 'single-window mode: navigating to stage', query);
	window.location.replace(url.toString());
	return true;
}

/**
 * One stage webview window per device entry — this is how several devices run
 * on one machine for testing. Window labels are stable (`device-<id>`) so
 * re-opening focuses instead of duplicating.
 */
export async function openDeviceWindow(device: DeviceEntry): Promise<void> {
	vlog('windows', 'open device window', { id: device.id, label: device.label });
	const query = `device=${encodeURIComponent(device.id)}`;
	const url = `index.html?${query}`;
	if (!isTauri()) {
		// Browser dev harness: a plain tab.
		window.open(`/?${query}`, `device-${device.id}`);
		return;
	}
	if (await navigateSingleWindow(query)) return;
	const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
	const label = `device-${device.id}`;
	const existing = await WebviewWindow.getByLabel(label);
	if (existing) {
		await existing.setFocus();
		return;
	}
	new WebviewWindow(label, {
		url,
		title: `RoomKit Player — ${device.label || device.deviceCode}`,
		width: 1280,
		height: 720,
		fullscreen: device.kiosk
	});
}

export interface TestWindowDevice {
	deviceId: string;
	deviceName: string;
	displayName: string;
	code: string;
}

/**
 * Auto-opened stage window for a studio-created test session (`test:start`).
 * The code travels in the URL — these devices are not launcher config entries.
 * Labels embed the session so a new test run replaces stale windows of the
 * same device (their codes died with the previous session) instead of
 * focusing them.
 */
export async function openTestDeviceWindow(
	sessionId: string,
	device: TestWindowDevice
): Promise<void> {
	return openCodedWindow('test', sessionId, device);
}

/**
 * Auto-opened stage window for a studio website test (`websiteTest:start`).
 * Identical to a test-session window — the URL under test arrives as a
 * navigate wire once the device socket attaches, so it survives reconnects
 * and can be re-pointed/reloaded live from studio.
 */
export async function openWebsiteTestWindow(
	runId: string,
	device: TestWindowDevice
): Promise<void> {
	return openCodedWindow('wtest', runId, device);
}

/** Close a website test's window(s); no-op in the browser harness and on mobile. */
export async function closeWebsiteTestWindows(runId: string): Promise<void> {
	if (!isTauri() || (await isMobile())) return;
	const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
	const suffix = `-${runId.slice(0, 8)}`;
	for (const w of await WebviewWindow.getAll()) {
		if (w.label.startsWith('wtest-') && w.label.endsWith(suffix)) {
			vlog('windows', 'close website test window', w.label);
			await w.destroy().catch(() => {});
		}
	}
}

async function openCodedWindow(
	prefix: 'test' | 'wtest',
	scopeId: string,
	device: TestWindowDevice
): Promise<void> {
	const label = device.displayName || device.deviceName;
	const query =
		`device=${encodeURIComponent(device.deviceId)}` +
		`&code=${encodeURIComponent(device.code)}` +
		`&label=${encodeURIComponent(label)}`;
	if (!isTauri()) {
		// Browser dev harness: a named tab per device — reused across sessions,
		// reloading picks up the new code.
		window.open(`/?${query}`, `${prefix}-${device.deviceId}`);
		return;
	}
	if (await navigateSingleWindow(query)) return;
	const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
	const windowLabel = `${prefix}-${device.deviceId}-${scopeId.slice(0, 8)}`;
	for (const w of await WebviewWindow.getAll()) {
		if (w.label.startsWith(`${prefix}-${device.deviceId}-`) && w.label !== windowLabel) {
			vlog('windows', 'replace stale window', w.label);
			await w.destroy().catch(() => {});
		}
	}
	const existing = await WebviewWindow.getByLabel(windowLabel);
	if (existing) {
		vlog('windows', 'focus existing window', windowLabel);
		await existing.setFocus();
		return;
	}
	vlog('windows', 'open window', windowLabel, { device: device.deviceName, label });
	new WebviewWindow(windowLabel, {
		url: `index.html?${query}`,
		title: `RoomKit Player — ${label}`,
		width: 1280,
		height: 720
	});
}
