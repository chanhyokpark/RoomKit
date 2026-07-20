import { z } from 'zod';
import { SequenceSchema } from './commands.js';
import { TriggerKindSchema } from './event.js';
import { JsonValueSchema } from './json.js';
import { TagSchema } from './tag.js';

export const AssetKindSchema = z.enum([
  'device',
  'bgm',
  'dialogue',
  'sfx',
  'video',
  'hint',
  'player',
  'website',
  'message',
  'phase',
  'event',
]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

// Per-kind `data` payloads. Device/Hint `code` is a top-level asset field, not in data.

export const DeviceDataSchema = z
  .object({
    /** Human-friendly label shown in UIs; `name` stays the logical identifier. */
    displayName: z.string(),
    /** This device runs the hint code-entry UI; hint:submit/next and admin pushes target it. */
    isHintDevice: z.boolean().default(false),
  })
  .strict();
export type DeviceData = z.infer<typeof DeviceDataSchema>;

export const BgmDataSchema = z.object({ fileKey: z.string().min(1) });
export type BgmData = z.infer<typeof BgmDataSchema>;

export const SfxDataSchema = z.object({ fileKey: z.string().min(1) });
export type SfxData = z.infer<typeof SfxDataSchema>;

export const VideoDataSchema = z.object({ fileKey: z.string().min(1) });
export type VideoData = z.infer<typeof VideoDataSchema>;

export const DialogueLineSchema = z.object({
  id: z.uuid(),
  fileKey: z.string().min(1),
  /** Subtitle for this voice line. HTML allowed (trusted admin input). */
  subtitleHtml: z.string(),
});
export type DialogueLine = z.infer<typeof DialogueLineSchema>;

export const DialogueDataSchema = z.object({
  keepSubtitleAfterEnd: z.boolean(),
  /** Array order = playback order. */
  lines: z.array(DialogueLineSchema),
});
export type DialogueData = z.infer<typeof DialogueDataSchema>;

export const HintStepSchema = z.object({
  /** Step content. HTML allowed (trusted admin input). */
  textHtml: z.string(),
  imageKey: z.string().min(1).nullable(),
});
export type HintStep = z.infer<typeof HintStepSchema>;

export const HintDataSchema = z.object({
  steps: z.array(HintStepSchema).min(1),
});
export type HintData = z.infer<typeof HintDataSchema>;

export const PlayerDataSchema = z.object({
  speakerDeviceId: z.uuid(),
  /** Device that renders subtitles and video. */
  screenDeviceId: z.uuid(),
  subtitleCss: z.string(),
});
export type PlayerData = z.infer<typeof PlayerDataSchema>;

export const WebsiteDataSchema = z.object({ url: z.url() });
export type WebsiteData = z.infer<typeof WebsiteDataSchema>;

export const MessageFieldTypeSchema = z.enum(['string', 'number', 'boolean', 'json']);
export type MessageFieldType = z.infer<typeof MessageFieldTypeSchema>;

/**
 * One field of a message payload schema. The asset only defines the shape;
 * concrete values are filled in by the sequence editor's "send message"
 * command per use.
 */
export const MessageFieldSchema = z.object({
  /** Payload property name. Unique within the message. */
  key: z.string().min(1),
  /** Editor-facing label for the value input. */
  label: z.string(),
  type: MessageFieldTypeSchema,
  required: z.boolean(),
});
export type MessageField = z.infer<typeof MessageFieldSchema>;

export const MessageDataSchema = z.object({
  /** Human-friendly label shown in UIs; `name` stays the logical identifier. */
  displayName: z.string(),
  /** Payload schema definition — values are provided in the editor. */
  fields: z.array(MessageFieldSchema),
});
export type MessageData = z.infer<typeof MessageDataSchema>;

export const PhaseDataSchema = z.object({
  /** Progression order (ascending). */
  order: z.number().int(),
});
export type PhaseData = z.infer<typeof PhaseDataSchema>;

export const EventDataSchema = z.object({
  /** Phase asset id. Null = common event, valid in every phase. */
  phaseId: z.uuid().nullable(),
  triggerKind: TriggerKindSchema,
  /** Device event name (device) or system hook name (system); null for manual. */
  triggerName: z.string().nullable(),
  manualTriggerable: z.boolean(),
  /** Re-entry of a running event is blocked by default. */
  allowReentry: z.boolean(),
  /** Authored in the M3 editor; kept verbatim by the asset manager. */
  sequence: SequenceSchema,
});
export type EventData = z.infer<typeof EventDataSchema>;

/** Full data schema per kind — used to validate `data` on create. */
export const assetDataSchemas = {
  device: DeviceDataSchema,
  bgm: BgmDataSchema,
  dialogue: DialogueDataSchema,
  sfx: SfxDataSchema,
  video: VideoDataSchema,
  hint: HintDataSchema,
  player: PlayerDataSchema,
  website: WebsiteDataSchema,
  message: MessageDataSchema,
  phase: PhaseDataSchema,
  event: EventDataSchema,
} as const;

/** Kinds whose assets carry a theme-unique `code`. */
export const CODED_ASSET_KINDS = ['device', 'hint'] as const satisfies AssetKind[];

const baseCreateFields = {
  name: z.string().min(1),
  description: z.string().optional(),
  tagIds: z.array(z.uuid()).optional(),
};

export const CreateAssetInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('device'),
    ...baseCreateFields,
    /** Unique within theme; used for production device registration. */
    code: z.string().min(1),
    data: DeviceDataSchema,
  }),
  z.object({ kind: z.literal('bgm'), ...baseCreateFields, data: BgmDataSchema }),
  z.object({ kind: z.literal('dialogue'), ...baseCreateFields, data: DialogueDataSchema }),
  z.object({ kind: z.literal('sfx'), ...baseCreateFields, data: SfxDataSchema }),
  z.object({ kind: z.literal('video'), ...baseCreateFields, data: VideoDataSchema }),
  z.object({
    kind: z.literal('hint'),
    ...baseCreateFields,
    /** 4-digit by default; auto-generated when omitted. Unique within theme. */
    code: z.string().min(1).optional(),
    data: HintDataSchema,
  }),
  z.object({ kind: z.literal('player'), ...baseCreateFields, data: PlayerDataSchema }),
  z.object({ kind: z.literal('website'), ...baseCreateFields, data: WebsiteDataSchema }),
  z.object({ kind: z.literal('message'), ...baseCreateFields, data: MessageDataSchema }),
  z.object({ kind: z.literal('phase'), ...baseCreateFields, data: PhaseDataSchema }),
  z.object({ kind: z.literal('event'), ...baseCreateFields, data: EventDataSchema }),
]);
export type CreateAssetInput = z.infer<typeof CreateAssetInputSchema>;

/**
 * Kind is immutable and not part of the update payload; the server validates
 * `data` against the stored asset's kind (full replacement, not a merge).
 */
export const UpdateAssetInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  tagIds: z.array(z.uuid()).optional(),
  /** Only meaningful for device/hint assets; rejected for other kinds. */
  code: z.string().min(1).optional(),
  data: JsonValueSchema.optional(),
});
export type UpdateAssetInput = z.infer<typeof UpdateAssetInputSchema>;

const assetEnvelopeFields = {
  id: z.uuid(),
  themeId: z.uuid(),
  name: z.string(),
  description: z.string(),
  code: z.string().nullable(),
  tags: z.array(TagSchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
};

export const AssetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('device'), ...assetEnvelopeFields, data: DeviceDataSchema }),
  z.object({ kind: z.literal('bgm'), ...assetEnvelopeFields, data: BgmDataSchema }),
  z.object({ kind: z.literal('dialogue'), ...assetEnvelopeFields, data: DialogueDataSchema }),
  z.object({ kind: z.literal('sfx'), ...assetEnvelopeFields, data: SfxDataSchema }),
  z.object({ kind: z.literal('video'), ...assetEnvelopeFields, data: VideoDataSchema }),
  z.object({ kind: z.literal('hint'), ...assetEnvelopeFields, data: HintDataSchema }),
  z.object({ kind: z.literal('player'), ...assetEnvelopeFields, data: PlayerDataSchema }),
  z.object({ kind: z.literal('website'), ...assetEnvelopeFields, data: WebsiteDataSchema }),
  z.object({ kind: z.literal('message'), ...assetEnvelopeFields, data: MessageDataSchema }),
  z.object({ kind: z.literal('phase'), ...assetEnvelopeFields, data: PhaseDataSchema }),
  z.object({ kind: z.literal('event'), ...assetEnvelopeFields, data: EventDataSchema }),
]);
export type Asset = z.infer<typeof AssetSchema>;
