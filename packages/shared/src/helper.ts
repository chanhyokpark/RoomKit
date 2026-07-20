import { z } from 'zod';
import { JsonValueSchema } from './json.js';
import { HintErrorSchema, HintShowSchema } from './protocol.js';

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

/** Sent once on construction; the player flushes buffered messages on it. */
export const HelperHelloSchema = z.object({
  source: z.literal(HELPER_SOURCE),
  type: z.literal('hello'),
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

export const HelperToPlayerSchema = z.discriminatedUnion('type', [
  HelperHelloSchema,
  HelperTriggerSchema,
  HelperHintSubmitSchema,
  HelperHintNextSchema,
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

export const PlayerToHelperSchema = z.discriminatedUnion('type', [
  PlayerMessageSchema,
  PlayerHintShowSchema,
  PlayerHintErrorSchema,
]);
export type PlayerToHelper = z.infer<typeof PlayerToHelperSchema>;
