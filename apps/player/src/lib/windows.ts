import { isTauri } from './tauri';
import type { DeviceEntry } from './stores/config.svelte';

/**
 * One stage webview window per device entry — this is how several devices run
 * on one machine for testing. Window labels are stable (`device-<id>`) so
 * re-opening focuses instead of duplicating.
 */
export async function openDeviceWindow(device: DeviceEntry): Promise<void> {
	const url = `index.html?device=${encodeURIComponent(device.id)}`;
	if (!isTauri()) {
		// Browser dev harness: a plain tab.
		window.open(`/?device=${encodeURIComponent(device.id)}`, `device-${device.id}`);
		return;
	}
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
	const label = device.displayName || device.deviceName;
	const query =
		`device=${encodeURIComponent(device.deviceId)}` +
		`&code=${encodeURIComponent(device.code)}` +
		`&label=${encodeURIComponent(label)}`;
	if (!isTauri()) {
		// Browser dev harness: a named tab per device — reused across sessions,
		// reloading picks up the new code.
		window.open(`/?${query}`, `test-${device.deviceId}`);
		return;
	}
	const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
	const windowLabel = `test-${device.deviceId}-${sessionId.slice(0, 8)}`;
	for (const w of await WebviewWindow.getAll()) {
		if (w.label.startsWith(`test-${device.deviceId}-`) && w.label !== windowLabel) {
			await w.destroy().catch(() => {});
		}
	}
	const existing = await WebviewWindow.getByLabel(windowLabel);
	if (existing) {
		await existing.setFocus();
		return;
	}
	new WebviewWindow(windowLabel, {
		url: `index.html?${query}`,
		title: `RoomKit Player — ${label}`,
		width: 1280,
		height: 720
	});
}
