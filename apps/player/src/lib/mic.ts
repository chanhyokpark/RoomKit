import { vlog } from './log';

/**
 * Microphone access for operator voice calls.
 *
 * The OS/webview permission prompt is raised once at app launch (from the
 * launcher) rather than mid-call: a stage window is a fullscreen, always-on-
 * top kiosk surface where a prompt is easy to miss or impossible to answer,
 * and on macOS/Android the decision is per app, so answering it in the
 * launcher covers every device window opened afterwards. wry grants the
 * webview-level request itself on macOS/iOS (the TCC prompt still shows) and
 * asks for RECORD_AUDIO at runtime on Android; WebView2 shows its own
 * per-origin prompt, which the launcher's webview can display normally.
 */
export async function warmUpMicrophone(): Promise<boolean> {
	if (!navigator.mediaDevices?.getUserMedia) {
		vlog('mic', 'getUserMedia unavailable');
		return false;
	}
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		for (const track of stream.getTracks()) track.stop();
		vlog('mic', 'permission granted');
		return true;
	} catch (err) {
		vlog('mic', 'permission denied', err);
		return false;
	}
}

/**
 * A silent audio track so a call can still be set up without a microphone:
 * the offer then carries an audio m-line the operator's answer can send
 * on, so the device hears the operator (listen-only). Returns the stream
 * plus a cleanup that releases the AudioContext.
 */
export function silentAudioStream(): { stream: MediaStream; release: () => void } {
	const ctx = new AudioContext();
	const destination = ctx.createMediaStreamDestination();
	// A running oscillator at zero gain keeps the track "live" (some stacks
	// drop tracks that never produce samples).
	const oscillator = ctx.createOscillator();
	const gain = ctx.createGain();
	gain.gain.value = 0;
	oscillator.connect(gain).connect(destination);
	oscillator.start();
	return {
		stream: destination.stream,
		release: () => {
			try {
				oscillator.stop();
			} catch {
				// already stopped
			}
			void ctx.close().catch(() => {});
		}
	};
}
