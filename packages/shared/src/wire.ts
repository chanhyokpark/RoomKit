import { z } from 'zod';
import { VideoFrameSchema } from './assets.js';
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
 * Looping BGM acks on playback start. Exception: a `message` wire with
 * `awaitHandled` is acked only once the consumer's message handlers settle.
 *
 * `id` is the delivery id — redeliveries reuse it, clients dedupe on it.
 */

export const PlayChannelSchema = z.enum(['bgm', 'sfx', 'dialogue', 'video']);
export type PlayChannel = z.infer<typeof PlayChannelSchema>;

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
  /**
   * BGM volume factor (0..1) applied on this player while the SFX plays.
   * From the player asset's sfxDuckPercent; absent = no ducking.
   */
  bgmDuck: z.number().min(0).max(1).optional(),
});
export type WirePlaySfx = z.infer<typeof WirePlaySfxSchema>;

export const WireDialogueLineSchema = z.object({
  lineId: z.uuid(),
  /** Null media = placeholder line; see wireMediaFields invariant. */
  fileKey: z.string().nullable(),
  url: z.url().nullable(),
  durationMs: z.number().int().positive().nullable(),
  subtitleHtml: z.string(),
  /**
   * The speaker must pause before this line and emit `progress` with
   * `waiting: true`; the server runs the authored line cue, then answers with
   * a plain `progress` for the same lineIndex as the go-ahead. The previous
   * subtitle stays up during the hold. Screen-role devices ignore this flag.
   */
  holdBefore: z.boolean().default(false),
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
  /** Dialogue asset's free-form params, forwarded for website-side rendering. */
  params: z.record(z.string(), JsonValueSchema).default({}),
  /**
   * BGM volume factor (0..1) applied on this player while the dialogue plays.
   * From the player asset's dialogueDuckPercent; absent = no ducking. Only
   * meaningful on the speaker role (where BGM audio also plays).
   */
  bgmDuck: z.number().min(0).max(1).optional(),
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
  /** Video asset's free-form params, forwarded for website-side rendering. */
  params: z.record(z.string(), JsonValueSchema).default({}),
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
  /** Recreate the iframe even when the URL is unchanged (forced reload). */
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
  /** Hint asset's free-form params, forwarded for website-side rendering. */
  params: z.record(z.string(), JsonValueSchema).default({}),
});
export type WireHintCode = z.infer<typeof WireHintCodeSchema>;

export const WireMessageSchema = z.object({
  ...wireBase,
  type: z.literal('message'),
  messageId: z.uuid(),
  messageName: z.string(),
  payload: z.record(z.string(), JsonValueSchema),
  /**
   * Defer the ack until every `message` listener's returned promise settles
   * ('failed' if any rejected). Absent/false = ack immediately on apply.
   * Set by the sendMessage command's waitUntilEnd (the sequence awaits it).
   */
  awaitHandled: z.boolean().optional(),
});
export type WireMessage = z.infer<typeof WireMessageSchema>;

/**
 * Invoke a parameterless callback the website registered via the helper's
 * `testCallbacks` option. Test sessions only (debug window). Acked 'done' when
 * the callback settled, 'failed' on unknown name/throw/timeout.
 */
export const WireTestCallbackSchema = z.object({
  ...wireBase,
  type: z.literal('testCallback'),
  name: z.string().min(1),
});
export type WireTestCallback = z.infer<typeof WireTestCallbackSchema>;

export const WireCommandSchema = z.union([
  WirePlayCommandSchema,
  WireStopSchema,
  WireNavigateSchema,
  WireResetSchema,
  WireMessageSchema,
  WireHintCodeSchema,
  WireTestCallbackSchema,
]);
export type WireCommand = z.infer<typeof WireCommandSchema>;

/**
 * Dialogue line sync. C→S from the speaker as each line starts; relayed S→C
 * to the screen device (subtitle sync). Two additional uses around line cues:
 * - C→S with `waiting: true` — the speaker reached a `holdBefore` line and is
 *   paused; never relayed to the screen.
 * - S→C to the *speaker* (plain, same lineIndex) — the go-ahead after the
 *   line cue finished; the speaker resumes with that line.
 */
export const PlaybackProgressSchema = z.object({
  commandId: z.uuid(),
  lineIndex: z.number().int().nonnegative(),
  waiting: z.boolean().default(false),
});
export type PlaybackProgress = z.infer<typeof PlaybackProgressSchema>;
