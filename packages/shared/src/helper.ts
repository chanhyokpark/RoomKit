import { z } from 'zod';
import { VideoFrameSchema } from './assets.js';
import { JsonValueSchema } from './json.js';
import { HintErrorSchema, HintShowSchema, SessionModeSchema } from './protocol.js';

/**
 * postMessage bridge between the tauri player and `@roomkit/helper` running
 * inside the player's website iframe. The helper never opens its own socket —
 * everything rides on the player's device connection.
 *
 * Contract:
 * - The helper posts to `window.parent` with targetOrigin `'*'` (it cannot
 *   know the player's origin; being embedded by the player is the trust
 *   anchor, and page content is creator-trusted per the SPEC security note).
 * - The player posts to the iframe with the navigated website's origin as
 *   targetOrigin, verifies `event.source === iframe.contentWindow` on inbound
 *   messages, and buffers outbound messages until the helper's `hello`.
 * - The helper bundles no zod: it type-checks envelopes structurally. The
 *   player validates inbound envelopes with `HelperToPlayerSchema`.
 */

export const HELPER_SOURCE = 'roomkit-helper';
export const PLAYER_SOURCE = 'roomkit-player';

// ── helper → player ────────────────────────────────────────────────────────

/**
 * Slots the website renders itself instead of the player. While a slot is
 * claimed the player suppresses its own overlay (video: renders no video
 * element at all) and forwards the slot's data to the helper instead.
 */
export const HelperRenderClaimsSchema = z.object({
  subtitle: z.boolean().default(false),
  hintCode: z.boolean().default(false),
  video: z.boolean().default(false),
});
export type HelperRenderClaims = z.infer<typeof HelperRenderClaimsSchema>;

/** Sent once on construction; the player flushes buffered messages on it. */
export const HelperHelloSchema = z.object({
  source: z.literal(HELPER_SOURCE),
  type: z.literal('hello'),
  /** Claims reset on navigation — each page re-declares them in its hello. */
  renders: HelperRenderClaimsSchema.default({ subtitle: false, hintCode: false, video: false }),
});
export type HelperHello = z.infer<typeof HelperHelloSchema>;

/** Mirrors the socket `trigger` payload. */
export const HelperTriggerSchema = z.object({
  source: z.literal(HELPER_SOURCE),
  type: z.literal('trigger'),
  event: z.string().min(1),
  payload: JsonValueSchema.optional(),
});
export type HelperTrigger = z.infer<typeof HelperTriggerSchema>;

export const HelperHintSubmitSchema = z.object({
  source: z.literal(HELPER_SOURCE),
  type: z.literal('hint:submit'),
  code: z.string().min(1),
});
export type HelperHintSubmit = z.infer<typeof HelperHintSubmitSchema>;

export const HelperHintNextSchema = z.object({
  source: z.literal(HELPER_SOURCE),
  type: z.literal('hint:next'),
  hintId: z.uuid(),
  step: z.number().int().nonnegative(),
});
export type HelperHintNext = z.infer<typeof HelperHintNextSchema>;

/**
 * Ask the player for the timer's remaining time; answered with a
 * `PlayerTimer` carrying the same `requestId`.
 */
export const HelperTimerGetSchema = z.object({
  source: z.literal(HELPER_SOURCE),
  type: z.literal('timer:get'),
  requestId: z.uuid(),
  /** Resynchronize the player's snapshot with the server before answering. */
  resync: z.boolean(),
});
export type HelperTimerGet = z.infer<typeof HelperTimerGetSchema>;

/** The site's video for a delegated play ended normally. Acks the play. */
export const HelperVideoEndedSchema = z.object({
  source: z.literal(HELPER_SOURCE),
  type: z.literal('video:ended'),
  commandId: z.uuid(),
});
export type HelperVideoEnded = z.infer<typeof HelperVideoEndedSchema>;

/** The site failed to play a delegated video; the play is acked as failed. */
export const HelperVideoErrorSchema = z.object({
  source: z.literal(HELPER_SOURCE),
  type: z.literal('video:error'),
  commandId: z.uuid(),
});
export type HelperVideoError = z.infer<typeof HelperVideoErrorSchema>;

export const HelperToPlayerSchema = z.discriminatedUnion('type', [
  HelperHelloSchema,
  HelperTriggerSchema,
  HelperHintSubmitSchema,
  HelperHintNextSchema,
  HelperTimerGetSchema,
  HelperVideoEndedSchema,
  HelperVideoErrorSchema,
]);
export type HelperToPlayer = z.infer<typeof HelperToPlayerSchema>;

// ── player → helper ────────────────────────────────────────────────────────

/** Subset of `WireMessage` — the delivery id stays player-side. */
export const PlayerMessageSchema = z.object({
  source: z.literal(PLAYER_SOURCE),
  type: z.literal('message'),
  messageId: z.uuid(),
  messageName: z.string(),
  payload: z.record(z.string(), JsonValueSchema),
});
export type PlayerMessage = z.infer<typeof PlayerMessageSchema>;

export const PlayerHintShowSchema = z.object({
  source: z.literal(PLAYER_SOURCE),
  type: z.literal('hint:show'),
  hint: HintShowSchema,
});
export type PlayerHintShow = z.infer<typeof PlayerHintShowSchema>;

export const PlayerHintErrorSchema = z.object({
  source: z.literal(PLAYER_SOURCE),
  type: z.literal('hint:error'),
  error: HintErrorSchema,
});
export type PlayerHintError = z.infer<typeof PlayerHintErrorSchema>;

/** Reply to a `HelperTimerGet` with the matching `requestId`. */
export const PlayerTimerSchema = z.object({
  source: z.literal(PLAYER_SOURCE),
  type: z.literal('timer'),
  requestId: z.uuid(),
  /**
   * Remaining timer milliseconds — frozen while paused, 0 when expired.
   * Null when the theme has no timer (or no session state is known yet).
   */
  remainingMs: z.number().int().nonnegative().nullable(),
});
export type PlayerTimer = z.infer<typeof PlayerTimerSchema>;

/** Current subtitle for a claimed subtitle slot; null clears the overlay. */
export const PlayerSubtitleSchema = z.object({
  source: z.literal(PLAYER_SOURCE),
  type: z.literal('subtitle'),
  subtitle: z
    .object({
      /** Line subtitle HTML (trusted admin input). */
      html: z.string(),
      /** Player asset's subtitleCss. */
      css: z.string(),
      /** Dialogue asset's free-form params. */
      params: z.record(z.string(), JsonValueSchema),
      lineIndex: z.number().int().nonnegative(),
      lineCount: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type PlayerSubtitle = z.infer<typeof PlayerSubtitleSchema>;

/** Current hint entry code for a claimed hintCode slot; null hides it. */
export const PlayerHintCodeSchema = z.object({
  source: z.literal(PLAYER_SOURCE),
  type: z.literal('hintCode'),
  hintCode: z
    .object({
      code: z.string(),
      /** Device asset's hintCodeCss. */
      css: z.string(),
      /** Hint asset's free-form params. */
      params: z.record(z.string(), JsonValueSchema),
    })
    .nullable(),
});
export type PlayerHintCode = z.infer<typeof PlayerHintCodeSchema>;

/**
 * Delegated video playback for a claimed video slot. The site plays the media
 * (audio included) and MUST report `video:ended` (or `video:error`) with the
 * same commandId — the play command is only acked then. Null url = placeholder
 * (fileless) asset: the player still simulates the duration for the ack; the
 * site may render its own placeholder for durationMs.
 */
export const PlayerVideoPlaySchema = z.object({
  source: z.literal(PLAYER_SOURCE),
  type: z.literal('video:play'),
  commandId: z.uuid(),
  assetName: z.string(),
  /** Presigned media URL (time-limited); null = placeholder. */
  url: z.url().nullable(),
  /** Simulated playback length; set exactly when url is null. */
  durationMs: z.number().int().positive().nullable(),
  /** Authored stage placement; null = fullscreen. The site may ignore it. */
  frame: VideoFrameSchema.nullable(),
  /** Video asset's free-form params. */
  params: z.record(z.string(), JsonValueSchema),
});
export type PlayerVideoPlay = z.infer<typeof PlayerVideoPlaySchema>;

/**
 * The session's mode, posted in reply to every helper `hello` (so a reloaded
 * page learns it again). In test sessions the helper keeps the context menu
 * usable so devtools stay reachable; production keeps the kiosk lockdown.
 */
export const PlayerModeSchema = z.object({
  source: z.literal(PLAYER_SOURCE),
  type: z.literal('mode'),
  mode: SessionModeSchema,
});
export type PlayerMode = z.infer<typeof PlayerModeSchema>;

/** Delegated video stopped (server stop, replacement, or skip). */
export const PlayerVideoStopSchema = z.object({
  source: z.literal(PLAYER_SOURCE),
  type: z.literal('video:stop'),
  commandId: z.uuid(),
});
export type PlayerVideoStop = z.infer<typeof PlayerVideoStopSchema>;

export const PlayerToHelperSchema = z.discriminatedUnion('type', [
  PlayerMessageSchema,
  PlayerHintShowSchema,
  PlayerHintErrorSchema,
  PlayerTimerSchema,
  PlayerSubtitleSchema,
  PlayerHintCodeSchema,
  PlayerVideoPlaySchema,
  PlayerVideoStopSchema,
  PlayerModeSchema,
]);
export type PlayerToHelper = z.infer<typeof PlayerToHelperSchema>;
