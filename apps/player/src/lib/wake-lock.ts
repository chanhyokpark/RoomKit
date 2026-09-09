import { vlog } from './log';

/**
 * Keep the display awake while a stage window is open — a hintphone tablet
 * or room screen must not dim/sleep between cues, whether or not the socket
 * is currently connected. Uses the Screen Wake Lock API, which every webview
 * the player ships in supports (WebView2, WKWebView 16.4+, Android WebView)
 * — but only in a secure context, so the Android dev build served over plain
 * `http://<host>:5175` gets no lock (release builds load `tauri.localhost`,
 * which Chromium treats as secure). The OS releases the lock whenever the
 * page is hidden, so it is re-requested on every return to visibility.
 */
export function keepScreenAwake(): () => void {
	const wakeLock = navigator.wakeLock;
	if (!wakeLock) {
		vlog('wake-lock', 'Screen Wake Lock API unavailable');
		return () => {};
	}

	let stopped = false;
	let sentinel: WakeLockSentinel | null = null;
	let pending: Promise<void> | null = null;

	const request = () => {
		if (stopped || sentinel || pending || document.visibilityState !== 'visible') return;
		pending = wakeLock
			.request('screen')
			.then((lock) => {
				if (stopped) {
					void lock.release();
					return;
				}
				sentinel = lock;
				vlog('wake-lock', 'acquired');
				lock.addEventListener('release', () => {
					if (sentinel === lock) sentinel = null;
					vlog('wake-lock', 'released by system');
					// Hidden → released; visibilitychange re-acquires. Anything
					// else (e.g. low battery) is worth one immediate retry.
					request();
				});
			})
			.catch((e: unknown) => {
				vlog('wake-lock', 'request failed', e);
			})
			.finally(() => {
				pending = null;
			});
	};

	const onVisibility = () => {
		if (document.visibilityState === 'visible') request();
	};
	document.addEventListener('visibilitychange', onVisibility);
	request();

	return () => {
		stopped = true;
		document.removeEventListener('visibilitychange', onVisibility);
		const lock = sentinel;
		sentinel = null;
		if (lock) {
			void lock.release().catch(() => {});
			vlog('wake-lock', 'released');
		}
	};
}
