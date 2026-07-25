import { z } from 'zod';
import { ComponentSlotSchema, VideoFrameSchema } from './assets.js';
import { JsonValueSchema } from './json.js';

/**
 * Wire-level commands delivered to devices over the /device namespace.
 *
 * The authoring commands (commands.ts) are resolved server-side into these
 * coarse wire commands: asset ids become presigned URLs, player targets are
 * split into per-device deliveries, and `waitUntilEnd` stays server-side (the
 * runtime decides whether the sequence awaits the ack; devices always ack).
 *
 * Ack contract: apply-type commands (stop/navigate/reset/message/hintCode) are
 * acked immediately on apply; play commands are acked when playback finishes.
 * Looping BGM acks on playback start.
 *
 * `id` is the delivery id — redeliveries reuse it, clients dedupe on it.
 */

export const PlayChannelSchema = z.enum(['bgm', 'sfx', 'dialogue', 'video']);
export type PlayChannel = z.infer<typeof PlayChannelSchema>;

/**
 * A component asset resolved server-side into its ready-to-mount payload:
 * the component's html plus the attachment's prop values. Clients mount it in
 * a sandboxed iframe via buildComponentSrcdoc() and feed it bridge events.
 */
export const WireComponentSchema = z.object({
  componentId: z.uuid(),
  /** Theme scope for name-based media lookups; '' on pre-field wires. */
  themeId: z.string().default(''),
  slot: ComponentSlotSchema,
  html: z.string(),
  props: z.record(z.string(), JsonValueSchema).default({}),
  /** Whether the iframe receives pointer events. */
  interactive: z.boolean().default(false),
});
export type WireComponent = z.infer<typeof WireComponentSchema>;

const wireBase = { id: z.uuid() };

/**
 * Media reference shared by all play wires. Invariant:
 * `fileKey === null ⇔ url === null ⇔ durationMs !== null`.
 * Null media = placeholder (fileless) asset: the client shows a placeholder,
 * simulates playback for `durationMs`, then acks as usual.
 */
const wireMediaFields = {
  /** Asset display name — shown by placeholder overlays. */
  assetName: z.string(),
  fileKey: z.string().nullable(),
  url: z.url().nullable(),
  /** Simulated playback length; set exactly when fileKey/url are null. */
  durationMs: z.number().int().positive().nullable(),
};

export const WirePlayBgmSchema = z.object({
  ...wireBase,
  type: z.literal('play'),
  channel: z.literal('bgm'),
  playerId: z.uuid(),
  assetId: z.uuid(),
  ...wireMediaFields,
  loop: z.boolean(),
  /** Volume ramp from 0 on playback start. 0 = no fade. From the BGM asset. */
  fadeInMs: z.number().int().nonnegative().default(0),
  /**
   * Volume ramp to 0 on stop or replacement (crossfade). 0 = immediate.
   * From the BGM asset; the client stores it and applies it when the track
   * is later stopped or replaced.
   */
  fadeOutMs: z.number().int().nonnegative().default(0),
});
export type WirePlayBgm = z.infer<typeof WirePlayBgmSchema>;

export const WirePlaySfxSchema = z.object({
  ...wireBase,
  type: z.literal('play'),
  channel: z.literal('sfx'),
  playerId: z.uuid(),
  assetId: z.uuid(),
  ...wireMediaFields,
});
export type WirePlaySfx = z.infer<typeof WirePlaySfxSchema>;

export const WireDialogueLineSchema = z.object({
  lineId: z.uuid(),
  /** Null media = placeholder line; see wireMediaFields invariant. */
  fileKey: z.string().nullable(),
  url: z.url().nullable(),
  durationMs: z.number().int().positive().nullable(),
  subtitleHtml: z.string(),
});
export type WireDialogueLine = z.infer<typeof WireDialogueLineSchema>;

/**
 * Dialogue playback. `role` is which half of the player this device is
 * ('both' when speaker === screen). The speaker plays audio and emits
 * `progress` per line; the server relays it to the screen, which renders
 * `lines[lineIndex].subtitleHtml`. The speaker's final ack ends playback.
 */
export const WirePlayDialogueSchema = z.object({
  ...wireBase,
  type: z.literal('play'),
  channel: z.literal('dialogue'),
  playerId: z.uuid(),
  assetId: z.uuid(),
  /** Asset display name — shown by placeholder overlays. */
  assetName: z.string(),
  role: z.enum(['speaker', 'screen', 'both']),
  lines: z.array(WireDialogueLineSchema),
  subtitleCss: z.string(),
  keepSubtitleAfterEnd: z.boolean(),
  /** Renders subtitles instead of the default overlay; subtitleCss unused then. */
  subtitleComponent: WireComponentSchema.nullable().default(null),
});
export type WirePlayDialogue = z.infer<typeof WirePlayDialogueSchema>;

export const WirePlayVideoSchema = z.object({
  ...wireBase,
  type: z.literal('play'),
  channel: z.literal('video'),
  playerId: z.uuid(),
  assetId: z.uuid(),
  ...wireMediaFields,
  /** Video surface placement on the stage; null = fullscreen. */
  frame: VideoFrameSchema.nullable().default(null),
  /** Component overlaid on the stage while the video plays. */
  component: WireComponentSchema.nullable().default(null),
});
export type WirePlayVideo = z.infer<typeof WirePlayVideoSchema>;

export const WirePlayCommandSchema = z.discriminatedUnion('channel', [
  WirePlayBgmSchema,
  WirePlaySfxSchema,
  WirePlayDialogueSchema,
  WirePlayVideoSchema,
]);
export type WirePlayCommand = z.infer<typeof WirePlayCommandSchema>;

/**
 * Stopping dialogue also clears any visible subtitle. BGM stops fade out with
 * the fadeOutMs delivered on the play wire.
 */
export const WireStopSchema = z.object({
  ...wireBase,
  type: z.literal('stop'),
  channel: PlayChannelSchema,
  /** Null = stop everything on this channel (the "all players" option). */
  playerId: z.uuid().nullable(),
  /** @deprecated Fade-out now rides WirePlayBgm; kept for one release, unused. */
  fadeOutMs: z.number().int().nonnegative().optional(),
});
export type WireStop = z.infer<typeof WireStopSchema>;

export const WireNavigateSchema = z.object({
  ...wireBase,
  type: z.literal('navigate'),
  websiteId: z.uuid(),
  url: z.url(),
  /** Recreate the iframe even when the URL is unchanged (website-test reload). */
  force: z.boolean().default(false),
});
export type WireNavigate = z.infer<typeof WireNavigateSchema>;

export const WireResetSchema = z.object({
  ...wireBase,
  type: z.literal('reset'),
});
export type WireReset = z.infer<typeof WireResetSchema>;

/**
 * Shows (code set) or hides (code null) the hint entry-code overlay on the
 * device screen. One code per device; a newer show replaces the previous.
 */
export const WireHintCodeSchema = z.object({
  ...wireBase,
  type: z.literal('hintCode'),
  code: z.string().nullable(),
  /** Device asset's hintCodeCss; injected raw (trusted admin input). */
  css: z.string().default(''),
  /** Renders the code instead of the default overlay; css unused then. */
  component: WireComponentSchema.nullable().default(null),
});
export type WireHintCode = z.infer<typeof WireHintCodeSchema>;

export const WireMessageSchema = z.object({
  ...wireBase,
  type: z.literal('message'),
  messageId: z.uuid(),
  messageName: z.string(),
  payload: z.record(z.string(), JsonValueSchema),
});
export type WireMessage = z.infer<typeof WireMessageSchema>;

export const WireCommandSchema = z.union([
  WirePlayCommandSchema,
  WireStopSchema,
  WireNavigateSchema,
  WireResetSchema,
  WireMessageSchema,
  WireHintCodeSchema,
]);
export type WireCommand = z.infer<typeof WireCommandSchema>;

/** C→S from the speaker as each dialogue line starts; relayed S→C to the screen. */
export const PlaybackProgressSchema = z.object({
  commandId: z.uuid(),
  lineIndex: z.number().int().nonnegative(),
});
export type PlaybackProgress = z.infer<typeof PlaybackProgressSchema>;
