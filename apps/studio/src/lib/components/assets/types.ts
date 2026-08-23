import type {
	Asset,
	AssetKind,
	HintStep,
	MessageField,
	SequenceEntry,
	TriggerKind,
	VideoFrame
} from '@roomkit/shared';

export type EditorState = { mode: 'create'; kind: AssetKind } | { mode: 'edit'; asset: Asset };

/** Dialogue line while editing — no fileKey = placeholder line. */
export interface DraftDialogueLine {
	id: string;
	fileKey: string | null;
	/** Simulated playback length while the line has no file. */
	durationMs: number;
	subtitleHtml: string;
}

/**
 * In-editor draft of asset `data`. Differs from the wire shape where editing
 * needs it (nullable file keys before upload, numbers as raw input text).
 * `paramsText` is the raw JSON text of the asset's free-form params.
 */
export type Draft =
	| {
			kind: 'device';
			displayName: string;
			isHintDevice: boolean;
			hintCodeCss: string;
	  }
	| { kind: 'bgm'; fileKey: string | null; durationMs: number; fadeInMs: number; fadeOutMs: number }
	| { kind: 'sfx'; fileKey: string | null; durationMs: number }
	| {
			kind: 'video';
			fileKey: string | null;
			durationMs: number;
			/** Placement on the stage in percent; null = fullscreen. */
			frame: VideoFrame | null;
			paramsText: string;
	  }
	| { kind: 'image'; fileKey: string | null; placeholderRatio: string }
	| { kind: 'file'; fileKey: string | null }
	| {
			kind: 'dialogue';
			keepSubtitleAfterEnd: boolean;
			lines: DraftDialogueLine[];
			paramsText: string;
	  }
	| { kind: 'hint'; steps: HintStep[]; answer: HintStep | null; paramsText: string }
	| {
			kind: 'player';
			speakerDeviceId: string;
			screenDeviceId: string;
			subtitleCss: string;
			/** BGM volume (%) while dialogue plays; null = no ducking. */
			dialogueDuckPercent: number | null;
			/** BGM volume (%) while any SFX plays; null = no ducking. */
			sfxDuckPercent: number | null;
	  }
	| { kind: 'website'; mode: 'external' | 'hosted'; url: string; sitePrefix: string | null }
	| { kind: 'message'; displayName: string; fields: MessageField[] }
	| { kind: 'phase'; orderText: string }
	| {
			kind: 'event';
			/** Phase asset id; empty string = common event. */
			phaseId: string;
			triggerKind: TriggerKind;
			triggerName: string;
			manualTriggerable: boolean;
			allowReentry: boolean;
			/** Run at most once; resets when the event's phase restarts. */
			once: boolean;
			/** Authored in the M3 editor; carried through untouched. */
			sequence: SequenceEntry[];
	  };
