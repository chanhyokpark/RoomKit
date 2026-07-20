import { isTauri } from './tauri';

/**
 * Best-effort kiosk lock for a stage window (per-device config toggle;
 * intended for Windows room devices, harmless on macOS/Linux dev machines):
 * fullscreen + always-on-top + hidden cursor, browser-shortcut suppression,
 * and close-request prevention. OS-level chords (Win key, Alt+Tab,
 * Ctrl+Alt+Del) cannot be blocked from an app — use Windows Assigned Access
 * for a hard lock. Escape chord: Ctrl+Shift+Alt+F12.
 */
export function startKiosk(): () => void {
	let locked = true;
	const cleanups: (() => void)[] = [];

	const onContextMenu = (e: Event) => {
		if (locked) e.preventDefault();
	};
	const onKeydown = (e: KeyboardEvent) => {
		if (e.ctrlKey && e.shiftKey && e.altKey && e.key === 'F12') {
			e.preventDefault();
			if (confirm('키오스크 잠금을 해제할까요?')) void unlock();
			return;
		}
		if (!locked) return;
		const browserChord =
			['F5', 'F11', 'F12'].includes(e.key) ||
			((e.ctrlKey || e.metaKey) && ['r', 'R', 'w', 'W', 'p', 'P', 'f', 'F'].includes(e.key)) ||
			((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'I', 'j', 'J'].includes(e.key));
		if (browserChord) e.preventDefault();
	};
	window.addEventListener('contextmenu', onContextMenu, true);
	window.addEventListener('keydown', onKeydown, true);
	cleanups.push(() => {
		window.removeEventListener('contextmenu', onContextMenu, true);
		window.removeEventListener('keydown', onKeydown, true);
	});

	document.body.classList.add('kiosk');
	cleanups.push(() => document.body.classList.remove('kiosk'));

	if (isTauri()) {
		void (async () => {
			const { getCurrentWindow } = await import('@tauri-apps/api/window');
			const win = getCurrentWindow();
			await win.setFullscreen(true).catch(() => {});
			await win.setAlwaysOnTop(true).catch(() => {});
			await win.setCursorVisible(false).catch(() => {});
			const unlisten = await win.onCloseRequested((event) => {
				if (locked) event.preventDefault();
			});
			cleanups.push(unlisten);
		})();
	}

	async function unlock(): Promise<void> {
		locked = false;
		document.body.classList.remove('kiosk');
		if (isTauri()) {
			const { getCurrentWindow } = await import('@tauri-apps/api/window');
			const win = getCurrentWindow();
			await win.setAlwaysOnTop(false).catch(() => {});
			await win.setFullscreen(false).catch(() => {});
			await win.setCursorVisible(true).catch(() => {});
		}
	}

	return () => {
		locked = false;
		for (const cleanup of cleanups.splice(0)) cleanup();
	};
}
