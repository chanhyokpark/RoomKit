import type { DeviceWindowState } from '@roomkit/shared';
import { vlog } from './log';
import { isTauri, platformName } from './tauri';

/**
 * Resolves once the document is visible (window shown, not minimized, not
 * fully covered). WKWebView/WebView2 flip `document.hidden` on occlusion, so
 * this is the signal that a capture will contain fresh pixels.
 */
export function waitUntilVisible(timeoutMs: number): Promise<void> {
	if (!document.hidden) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const finish = (ok: boolean) => {
			clearTimeout(timer);
			clearInterval(poll);
			document.removeEventListener('visibilitychange', onChange);
			if (ok) resolve();
			else reject(new Error('Player window is still hidden (minimized or covered by another window)'));
		};
		const onChange = () => {
			if (!document.hidden) finish(true);
		};
		const timer = setTimeout(() => finish(!document.hidden), timeoutMs);
		// Occlusion changes do not always fire visibilitychange promptly.
		const poll = setInterval(onChange, 100);
		document.addEventListener('visibilitychange', onChange);
	});
}

/**
 * Bring this stage window to the front: show it, restore it from the dock /
 * taskbar, give it focus (on macOS this also activates the app), then wait
 * until the document is visible so a following capture is not stale. Each
 * native step is best-effort — mobile webviews have no window to manage.
 */
export async function focusStageWindow(timeoutMs: number): Promise<void> {
	if (isTauri()) {
		const { getCurrentWindow } = await import('@tauri-apps/api/window');
		const win = getCurrentWindow();
		await win.show().catch((err) => vlog('window', 'show failed', err));
		if (await win.isMinimized().catch(() => false)) {
			await win.unminimize().catch((err) => vlog('window', 'unminimize failed', err));
		}
		await win.setFocus().catch((err) => vlog('window', 'setFocus failed', err));
	} else {
		window.focus();
	}
	await waitUntilVisible(timeoutMs);
}

/** What the window looks like right now, reported back to the test tooling. */
export async function stageWindowState(): Promise<DeviceWindowState> {
	const visible = !document.hidden;
	if (!isTauri()) return { visible, focused: document.hasFocus(), platform: 'web' };
	const [{ getCurrentWindow }, platform] = await Promise.all([
		import('@tauri-apps/api/window'),
		platformName()
	]);
	const focused = await getCurrentWindow()
		.isFocused()
		.catch(() => document.hasFocus());
	return { visible, focused, platform };
}
