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
  'image',
  'file',
  'hint',
  'player',
  'website',
  'message',
  'component',
  'phase',
  'event',
]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

/**
 * Where a component asset can be mounted. Components render in a sandboxed
 * iframe layered on the stage and receive runtime data via the RoomKit bridge
 * (see component-host.ts).
 */
export const ComponentSlotSchema = z.enum(['video', 'subtitle', 'hintCode']);
export type ComponentSlot = z.infer<typeof ComponentSlotSchema>;

/**
 * A media asset's attachment of a component: which component to mount plus
 * per-use prop values (keyed by the component's `params` definitions), so one
 * component is reusable across assets with different content.
 */
export const ComponentRefSchema = z.object({
  componentId: z.uuid(),
  props: z.record(z.string(), JsonValueSchema).default({}),
});
export type ComponentRef = z.infer<typeof ComponentRefSchema>;

/**
 * Where the video surface sits on the stage, in percent of the stage size.
 * Null frame = fullscreen (the pre-frame behavior).
 */
export const VideoFrameSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().gt(0).max(100),
  height: z.number().gt(0).max(100),
});
export type VideoFrame = z.infer<typeof VideoFrameSchema>;

// Per-kind `data` payloads. Device/Hint `code` is a top-level asset field, not in data.

export const DeviceDataSchema = z
  .object({
    /** Human-friendly label shown in UIs; `name` stays the logical identifier. */
    displayName: z.string(),
    /** This device runs the hint code-entry UI; hint:submit/next and admin pushes target it. */
    isHintDevice: z.boolean().default(false),
    /**
     * CSS applied to the on-screen hint code overlay (`.rk-hint-code`) shown by
     * the showHintCode command. Trusted admin input, injected raw.
     */
    hintCodeCss: z.string().default(''),
    /**
     * Component rendering the hint code overlay instead of the default
     * `.rk-hint-code` box; hintCodeCss is ignored while set.
     */
    hintCodeComponent: ComponentRefSchema.nullable().default(null),
  })
  .strict();
export type DeviceData = z.infer<typeof DeviceDataSchema>;

/**
 * Simulated playback length for placeholder (fileless) media, per kind.
 * Applied as a zod default so legacy rows without the field parse unchanged.
 */
export const PLACEHOLDER_DURATION_DEFAULTS = {
  bgm: 2000,
  sfx: 2000,
  video: 5000,
  dialogueLine: 3000,
} as const;

export const BgmDataSchema = z.object({
  /** Null = placeholder (fileless) asset: clients simulate playback for durationMs. */
  fileKey: z.string().min(1).nullable(),
  /** Simulated playback length when fileKey is null; ignored otherwise. */
  durationMs: z.number().int().positive().default(PLACEHOLDER_DURATION_DEFAULTS.bgm),
  /** Volume ramp from 0 on playback start. 0 = no fade. */
  fadeInMs: z.number().int().nonnegative().default(0),
  /** Volume ramp to 0 on stop or replacement (crossfade). 0 = immediate. */
  fadeOutMs: z.number().int().nonnegative().default(0),
});
export type BgmData = z.infer<typeof BgmDataSchema>;

export const SfxDataSchema = z.object({
  /** Null = placeholder (fileless) asset: clients simulate playback for durationMs. */
  fileKey: z.string().min(1).nullable(),
  /** Simulated playback length when fileKey is null; ignored otherwise. */
  durationMs: z.number().int().positive().default(PLACEHOLDER_DURATION_DEFAULTS.sfx),
});
export type SfxData = z.infer<typeof SfxDataSchema>;

export const VideoDataSchema = z.object({
  /** Null = placeholder (fileless) asset: clients simulate playback for durationMs. */
  fileKey: z.string().min(1).nullable(),
  /** Simulated playback length when fileKey is null; ignored otherwise. */
  durationMs: z.number().int().positive().default(PLACEHOLDER_DURATION_DEFAULTS.video),
  /** Video surface placement on the stage; null = fullscreen. */
  frame: VideoFrameSchema.nullable().default(null),
  /** Component overlaid on the stage while this video plays (e.g. a chat UI). */
  component: ComponentRefSchema.nullable().default(null),
});
export type VideoData = z.infer<typeof VideoDataSchema>;

/**
 * Static resources for hosted websites — the studio runtime never plays them.
 * Served publicly at `/api/media/{assetId}` (stable URL, unlike presigns).
 */
export const ImageDataSchema = z.object({
  /** Null = no file; the public media URL serves a generated placeholder. */
  fileKey: z.string().min(1).nullable(),
  /** Aspect ratio ("W:H") of the placeholder served while fileKey is null. */
  placeholderRatio: z
    .string()
    .regex(/^[1-9]\d*:[1-9]\d*$/)
    .default('16:9'),
});
export type ImageData = z.infer<typeof ImageDataSchema>;

/** Arbitrary file counterpart of {@link ImageDataSchema}. */
export const FileDataSchema = z.object({
  /** Null = not uploaded yet; the public media URL 404s until set. */
  fileKey: z.string().min(1).nullable(),
});
export type FileData = z.infer<typeof FileDataSchema>;

export const DialogueLineSchema = z.object({
  id: z.uuid(),
  /** Null = placeholder (fileless) line: clients simulate playback for durationMs. */
  fileKey: z.string().min(1).nullable(),
  /** Simulated playback length when fileKey is null; ignored otherwise. */
  durationMs: z.number().int().positive().default(PLACEHOLDER_DURATION_DEFAULTS.dialogueLine),
  /** Subtitle for this voice line. HTML allowed (trusted admin input). */
  subtitleHtml: z.string(),
});
export type DialogueLine = z.infer<typeof DialogueLineSchema>;

export const DialogueDataSchema = z.object({
  keepSubtitleAfterEnd: z.boolean(),
  /** Array order = playback order. */
  lines: z.array(DialogueLineSchema),
  /**
   * Subtitle component for this dialogue; null falls back to the player's
   * subtitleComponent, then to the default `.rk-subtitle` overlay.
   */
  subtitleComponent: ComponentRefSchema.nullable().default(null),
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
  /**
   * Default subtitle component for dialogues on this player; a dialogue's own
   * subtitleComponent wins. Null = default `.rk-subtitle` overlay + subtitleCss.
   */
  subtitleComponent: ComponentRefSchema.nullable().default(null),
});
export type PlayerData = z.infer<typeof PlayerDataSchema>;

const websiteDataBranches = z.discriminatedUnion('mode', [
  /** Externally hosted site — registered by URL (the original, pre-M6 shape). */
  z.object({ mode: z.literal('external'), url: z.url() }),
  z.object({
    mode: z.literal('hosted'),
    /**
     * S3 prefix holding the extracted site (`sites/{themeId}/{uuid}`).
     * Immutable: re-upload writes a new prefix and swaps this pointer.
     * Served by the server at `/api/sites/{assetId}/`.
     */
    sitePrefix: z.string().min(1),
  }),
]);
/** Legacy rows predate `mode` and are plain `{url}` — coerce them to external. */
export const WebsiteDataSchema = z.preprocess(
  (v) => (v && typeof v === 'object' && !('mode' in v) ? { ...v, mode: 'external' } : v),
  websiteDataBranches,
);
export type WebsiteData = z.infer<typeof websiteDataBranches>;

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

/**
 * Reusable HTML component (with JS) mounted on the stage for a slot. Trusted
 * admin input: the document runs in a sandboxed iframe purely for fault/style
 * isolation, and talks to the host via the `window.RoomKit` bridge.
 */
export const ComponentDataSchema = z.object({
  slot: ComponentSlotSchema,
  /**
   * Body markup; inline `<style>`/`<script>` allowed. Wrapped into a full
   * document with the bridge SDK by buildComponentSrcdoc().
   */
  html: z.string(),
  /**
   * Prop definitions filled per attachment (ComponentRef.props) — reuses the
   * message field shape so one component serves many assets.
   */
  params: z.array(MessageFieldSchema).default([]),
  /**
   * Whether the iframe receives pointer events. Off by default so a
   * full-stage overlay doesn't swallow clicks meant for the website below.
   */
  interactive: z.boolean().default(false),
});
export type ComponentData = z.infer<typeof ComponentDataSchema>;

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
  image: ImageDataSchema,
  file: FileDataSchema,
  hint: HintDataSchema,
  player: PlayerDataSchema,
  website: WebsiteDataSchema,
  message: MessageDataSchema,
  component: ComponentDataSchema,
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
  z.object({ kind: z.literal('image'), ...baseCreateFields, data: ImageDataSchema }),
  z.object({ kind: z.literal('file'), ...baseCreateFields, data: FileDataSchema }),
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
  z.object({ kind: z.literal('component'), ...baseCreateFields, data: ComponentDataSchema }),
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
  z.object({ kind: z.literal('image'), ...assetEnvelopeFields, data: ImageDataSchema }),
  z.object({ kind: z.literal('file'), ...assetEnvelopeFields, data: FileDataSchema }),
  z.object({ kind: z.literal('hint'), ...assetEnvelopeFields, data: HintDataSchema }),
  z.object({ kind: z.literal('player'), ...assetEnvelopeFields, data: PlayerDataSchema }),
  z.object({ kind: z.literal('website'), ...assetEnvelopeFields, data: WebsiteDataSchema }),
  z.object({ kind: z.literal('message'), ...assetEnvelopeFields, data: MessageDataSchema }),
  z.object({ kind: z.literal('component'), ...assetEnvelopeFields, data: ComponentDataSchema }),
  z.object({ kind: z.literal('phase'), ...assetEnvelopeFields, data: PhaseDataSchema }),
  z.object({ kind: z.literal('event'), ...assetEnvelopeFields, data: EventDataSchema }),
]);
export type Asset = z.infer<typeof AssetSchema>;
