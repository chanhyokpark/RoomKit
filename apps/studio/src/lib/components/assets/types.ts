import type {
	Asset,
	AssetKind,
	HintStep,
	MessageField,
	SequenceEntry,
	TriggerKind
} from '@roomkit/shared';

export type EditorState = { mode: 'create'; kind: AssetKind } | { mode: 'edit'; asset: Asset };

/** Dialogue line while editing — fileKey may still be missing. */
export interface DraftDialogueLine {
	id: string;
	fileKey: string | null;
	subtitleHtml: string;
}

/**
 * In-editor draft of asset `data`. Differs from the wire shape where editing
 * needs it (nullable file keys before upload, numbers as raw input text).
 */
export type Draft =
	| { kind: 'device'; displayName: string }
	| { kind: 'bgm' | 'sfx' | 'video'; fileKey: string | null }
	| { kind: 'dialogue'; keepSubtitleAfterEnd: boolean; lines: DraftDialogueLine[] }
	| { kind: 'hint'; steps: HintStep[] }
	| { kind: 'player'; speakerDeviceId: string; screenDeviceId: string; subtitleCss: string }
	| { kind: 'website'; url: string }
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
			/** Authored in the M3 editor; carried through untouched. */
			sequence: SequenceEntry[];
	  };
