/**
 * Global audio mute for the stage window, used while a voice call is active:
 * every audio element the playback channels create passes through
 * `registerAudio`, so muting applies to running tracks and to tracks that
 * start mid-call alike. Elements are held weakly — channels drop their
 * references on stop and the set prunes itself.
 */
let muted = false;
const elements = new Set<WeakRef<HTMLAudioElement>>();

export function registerAudio(audio: HTMLAudioElement): void {
	audio.muted = muted;
	elements.add(new WeakRef(audio));
}

export function setAudioMuted(value: boolean): void {
	muted = value;
	for (const ref of [...elements]) {
		const audio = ref.deref();
		if (!audio) {
			elements.delete(ref);
			continue;
		}
		audio.muted = value;
	}
}

export function isAudioMuted(): boolean {
	return muted;
}
