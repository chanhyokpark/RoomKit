import { vlog } from '../log';

/**
 * Element volume that also works on iOS. WebKit on iOS ignores writes to
 * `HTMLMediaElement.volume` (it always reads 1 — loudness belongs to the
 * hardware buttons), so there the element is routed through a Web Audio
 * GainNode instead and the gain carries the volume. Everywhere else this is
 * a plain `audio.volume` write.
 *
 * Routing needs CORS-clean media — a cross-origin element without
 * `crossOrigin` feeds the graph silence — so `createAudio` marks cached
 * (loopback) sources `anonymous` on these platforms. A stream straight from
 * a presigned URL is left unrouted and plays at full volume: storage CORS is
 * deployment-specific, and loud beats silent.
 */

let writable: boolean | null = null;

/** False where `audio.volume` is read-only (iOS). */
export function volumeIsWritable(): boolean {
	if (writable === null) {
		const probe = new Audio();
		probe.volume = 0.5;
		writable = probe.volume === 0.5;
	}
	return writable;
}

interface Route {
	source: MediaElementAudioSourceNode;
	gain: GainNode;
	value: number;
	onMuteChange: () => void;
}

let context: AudioContext | null = null;
const routes = new WeakMap<HTMLMediaElement, Route>();
/** Elements that cannot be routed (cross-origin without CORS); warned once each. */
const unroutable = new WeakSet<HTMLMediaElement>();

function audioContext(): AudioContext {
	if (!context) {
		const ctx = new AudioContext();
		// iOS parks the context ('interrupted') around calls and mic capture;
		// a routed element is silent until it runs again.
		ctx.addEventListener('statechange', () => {
			if (ctx.state !== 'running' && ctx.state !== 'closed') void ctx.resume().catch(() => {});
		});
		context = ctx;
	}
	if (context.state !== 'running') void context.resume().catch(() => {});
	return context;
}

function isCorsClean(audio: HTMLMediaElement): boolean {
	if (audio.crossOrigin !== null) return true;
	const src = audio.currentSrc || audio.src;
	if (!src || src.startsWith('blob:') || src.startsWith('data:')) return true;
	try {
		return new URL(src, location.href).origin === location.origin;
	} catch {
		return false;
	}
}

function applyGain(audio: HTMLMediaElement, route: Route): void {
	// The element's own mute should already silence the graph; mirroring it
	// into the gain keeps the call mute reliable regardless.
	route.gain.gain.value = audio.muted ? 0 : route.value;
}

function routeFor(audio: HTMLMediaElement): Route | null {
	const existing = routes.get(audio);
	if (existing) return existing;
	if (unroutable.has(audio)) return null;
	if (!isCorsClean(audio)) {
		unroutable.add(audio);
		vlog('volume', 'cross-origin stream without CORS: volume control unavailable');
		return null;
	}
	try {
		const ctx = audioContext();
		const source = ctx.createMediaElementSource(audio);
		const gain = ctx.createGain();
		source.connect(gain).connect(ctx.destination);
		const route: Route = { source, gain, value: 1, onMuteChange: () => applyGain(audio, route) };
		audio.addEventListener('volumechange', route.onMuteChange);
		routes.set(audio, route);
		return route;
	} catch (error) {
		unroutable.add(audio);
		vlog('volume', 'gain routing failed', error);
		return null;
	}
}

/** Sets the audible volume (0..1) of an element. */
export function setVolume(audio: HTMLMediaElement, value: number): void {
	const clamped = Math.max(0, Math.min(1, value));
	if (volumeIsWritable()) {
		audio.volume = clamped;
		return;
	}
	const route = routeFor(audio);
	if (!route) return;
	route.value = clamped;
	applyGain(audio, route);
}

/** The volume last set through `setVolume` (1 when never set). */
export function getVolume(audio: HTMLMediaElement): number {
	if (volumeIsWritable()) return audio.volume;
	return routes.get(audio)?.value ?? 1;
}

/** True once the element plays through a gain (and must stay CORS-clean). */
export function hasVolumeRoute(audio: HTMLMediaElement): boolean {
	return routes.has(audio);
}

/** Tears down the gain route once the element is finished with. */
export function releaseVolume(audio: HTMLMediaElement): void {
	const route = routes.get(audio);
	if (!route) return;
	routes.delete(audio);
	audio.removeEventListener('volumechange', route.onMuteChange);
	route.source.disconnect();
	route.gain.disconnect();
}
