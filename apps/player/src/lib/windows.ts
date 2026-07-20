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
