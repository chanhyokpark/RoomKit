import type { HelperRenderClaims, JsonValue, PlayChannel, VideoFrame } from '@roomkit/shared';

export interface Subtitle {
	html: string;
	css: string;
	/** Dialogue asset's free-form params, forwarded to a claiming website. */
	params: Record<string, JsonValue>;
	lineIndex: number;
	lineCount: number;
}

/** The hint entry-code overlay (top-right); css comes from the device asset. */
export interface HintCode {
	code: string;
	css: string;
	/** Hint asset's free-form params, forwarded to a claiming website. */
	params: Record<string, JsonValue>;
}

/** A video playback delegated to the claiming website instead of the stage. */
export interface DelegatedVideo {
	/** Wire command id — the site's video:ended/video:error must echo it. */
	commandId: string;
	assetName: string;
	/** Presigned media URL; null = placeholder (fileless) asset. */
	url: string | null;
	/** Simulated playback length; set exactly when url is null. */
	durationMs: number | null;
	frame: VideoFrame | null;
	params: Record<string, JsonValue>;
}

/** Playback-side handlers for delegated-video reports from the website. */
export interface VideoDelegate {
	ended(commandId: string): void;
	error(commandId: string): void;
	/** The claiming site went away (navigation/teardown) mid-playback. */
	detach(): void;
}

export interface Skippable {
	/** Wire command id of the running playback. */
	id: string;
	kind: 'dialogue' | 'video';
	skip: () => void;
}

/** A running placeholder (fileless) simulation, rendered as an overlay chip. */
export interface PlaceholderChip {
	/** Wire command id of the simulated playback. */
	id: string;
	channel: PlayChannel;
	name: string;
}

const NO_CLAIMS: HelperRenderClaims = { subtitle: false, hintCode: false, video: false };

/**
 * What the stage window currently shows. Playback channels write here; the
 * DOM (Stage.svelte and friends) only reads.
 */
class StageStore {
	videoSrc = $state<string | null>(null);
	/** Asset name shown on the video surface while a placeholder video simulates. */
	videoPlaceholder = $state<string | null>(null);
	/** Video surface placement (percent of stage); null = fullscreen. */
	videoFrame = $state<VideoFrame | null>(null);
	subtitle = $state<Subtitle | null>(null);
	/** One code per device window; a newer show replaces the previous. */
	hintCode = $state<HintCode | null>(null);
	/**
	 * Slots the embedded website claimed via the helper's hello. While claimed
	 * the player suppresses its own rendering and forwards the data instead;
	 * claims reset whenever the iframe (re)loads or goes away.
	 */
	helperRenders = $state<HelperRenderClaims>(NO_CLAIMS);
	/** Video playback handed to the claiming website; null = none. */
	delegatedVideo = $state<DelegatedVideo | null>(null);
	/** Registered by the playback engine; the helper bridge reports into it. */
	videoDelegate: VideoDelegate | null = null;
	iframeUrl = $state<string | null>(null);
	/** Bumped by forced same-URL navigates so the #key'd iframe re-creates. */
	reloadNonce = $state(0);
	/** Ack of the in-flight navigate — resolved when the iframe finishes loading. */
	private navigateDone: (() => void) | null = null;
	/** Running skippable playbacks — the test overlay renders one button each. */
	skippables = $state<Skippable[]>([]);
	/** Running placeholder simulations — rendered as corner chips. */
	placeholders = $state<PlaceholderChip[]>([]);

	addSkippable(entry: Skippable): void {
		this.skippables = [...this.skippables.filter((s) => s.id !== entry.id), entry];
	}

	removeSkippable(id: string): void {
		this.skippables = this.skippables.filter((s) => s.id !== id);
	}

	addPlaceholder(entry: PlaceholderChip): void {
		this.placeholders = [...this.placeholders.filter((p) => p.id !== entry.id), entry];
	}

	removePlaceholder(id: string): void {
		this.placeholders = this.placeholders.filter((p) => p.id !== id);
	}

	/** The claiming website is gone: restore player rendering, unstick playback. */
	dropHelperClaims(): void {
		this.helperRenders = NO_CLAIMS;
		this.videoDelegate?.detach();
	}

	/**
	 * Wire navigate: show the website and ack (`done`) once its iframe has
	 * loaded — the server sequence waits on that ack. A pending ack that gets
	 * superseded (new navigate / reset) is released immediately so the older
	 * sequence never stalls on a site that will no longer load.
	 */
	navigate(url: string, done: () => void, force = false): void {
		this.releaseNavigateAck();
		if (this.iframeUrl === url) {
			if (!force) {
				// Same URL: the #key'd iframe won't re-create, so no load will fire.
				done();
				return;
			}
			// Forced reload (website test): re-create the iframe for the same URL.
			this.reloadNonce++;
		}
		this.navigateDone = done;
		this.iframeUrl = url;
	}

	/** The website iframe finished loading (reported by WebsiteFrame). */
	siteLoaded(): void {
		this.releaseNavigateAck();
	}

	private releaseNavigateAck(): void {
		this.navigateDone?.();
		this.navigateDone = null;
	}

	/** Device reset: back to the idle black screen. */
	clear(): void {
		this.videoSrc = null;
		this.videoPlaceholder = null;
		this.videoFrame = null;
		this.subtitle = null;
		this.hintCode = null;
		this.helperRenders = NO_CLAIMS;
		this.delegatedVideo = null;
		this.iframeUrl = null;
		this.skippables = [];
		this.placeholders = [];
		this.releaseNavigateAck();
	}
}

export const stage = new StageStore();
