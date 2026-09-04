import type { HapticsRequest } from '@roomkit/shared';
import { isTauri } from './tauri';

/**
 * Runs one haptics request on this device through the tauri haptics plugin
 * (real feedback on Android/iOS, a no-op on desktop). In the browser dev
 * harness `vibrate` falls back to the Vibration API where the browser has
 * it; the feedback variants become a no-op like desktop. Rejects with the
 * plugin's error text so the caller can relay it.
 */
export async function runHaptics(request: HapticsRequest): Promise<void> {
	if (!isTauri()) {
		if (request.kind === 'vibrate' && typeof navigator.vibrate === 'function') {
			navigator.vibrate(request.duration);
		}
		return;
	}
	const haptics = await import('@tauri-apps/plugin-haptics');
	const result = await (() => {
		switch (request.kind) {
			case 'vibrate':
				return haptics.vibrate(request.duration);
			case 'impact':
				return haptics.impactFeedback(request.style);
			case 'notification':
				return haptics.notificationFeedback(request.type);
			case 'selection':
				return haptics.selectionFeedback();
		}
	})();
	if (result.status === 'error') {
		throw new Error(String(result.error ?? 'haptics failed'));
	}
}
