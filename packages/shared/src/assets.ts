import { z } from 'zod';
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
]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

// Per-kind `data` payloads. Device/Hint `code` is a top-level asset field, not in data.

export const DeviceDataSchema = z.object({}).strict();
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

export const MessageDataSchema = z.object({
  payload: z.union([z.string(), JsonValueSchema]),
});
export type MessageData = z.infer<typeof MessageDataSchema>;

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
} as const;

/** Kinds whose assets carry a theme-unique `code`. */
export const CODED_ASSET_KINDS = ['device', 'hint'] as const satisfies AssetKind[];

const baseCreateFields = {
  name: z.string().min(1),
  tagIds: z.array(z.uuid()).optional(),
};

export const CreateAssetInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('device'),
    ...baseCreateFields,
    /** Unique within theme; used for production device registration. */
    code: z.string().min(1),
    data: DeviceDataSchema.default({}),
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
]);
export type CreateAssetInput = z.infer<typeof CreateAssetInputSchema>;

/**
 * Kind is immutable and not part of the update payload; the server validates
 * `data` against the stored asset's kind (full replacement, not a merge).
 */
export const UpdateAssetInputSchema = z.object({
  name: z.string().min(1).optional(),
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
]);
export type Asset = z.infer<typeof AssetSchema>;
