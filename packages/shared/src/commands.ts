import { z } from 'zod';
import { JsonValueSchema } from './json.js';

/**
 * An asset reference in a command. Null = not configured yet: the editor (M3)
 * autosaves work-in-progress commands, so unset references must be storable.
 * The runtime treats a null ref like a dangling one — the command is logged
 * and skipped, never fatal to the run.
 */
const assetRef = z.uuid().nullable();

/**
 * Sequence command definitions. The runtime (M2) executes these on the server;
 * the editor (M3) authors them. Stored as a JSON array on Event.sequence.
 */
export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('resetDevice'), deviceId: assetRef }),
  z.object({
    type: z.literal('playDialogue'),
    dialogueId: assetRef,
    playerId: assetRef,
    waitUntilEnd: z.boolean(),
  }),
  z.object({
    type: z.literal('stopDialogue'),
    playerId: assetRef,
    /** Stop on every player; playerId is ignored when set. */
    allPlayers: z.boolean().default(false),
  }),
  z.object({ type: z.literal('playSfx'), sfxId: assetRef, playerId: assetRef }),
  z.object({
    type: z.literal('stopSfx'),
    playerId: assetRef,
    /** Stop on every player; playerId is ignored when set. */
    allPlayers: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('playVideo'),
    videoId: assetRef,
    playerId: assetRef,
    waitUntilEnd: z.boolean(),
  }),
  z.object({
    type: z.literal('stopVideo'),
    playerId: assetRef,
    /** Stop on every player; playerId is ignored when set. */
    allPlayers: z.boolean().default(false),
  }),
  /** Fade in/out durations come from the BGM asset's data, not the command. */
  z.object({
    type: z.literal('playBgm'),
    bgmId: assetRef,
    playerId: assetRef,
    loop: z.boolean(),
  }),
  z.object({
    type: z.literal('stopBgm'),
    playerId: assetRef,
    /** Stop on every player; playerId is ignored when set. */
    allPlayers: z.boolean().default(false),
  }),
  z.object({ type: z.literal('wait'), durationMs: z.number().int().positive() }),
  z.object({ type: z.literal('navigate'), deviceId: assetRef, websiteId: assetRef }),
  z.object({
    type: z.literal('sendMessage'),
    deviceId: assetRef,
    messageId: assetRef,
    /** Concrete values for the message asset's field schema, entered in the editor. */
    values: z.record(z.string(), JsonValueSchema),
  }),
  z.object({ type: z.literal('switchPhase'), phaseId: assetRef }),
  z.object({
    type: z.literal('callEvent'),
    eventId: assetRef,
    /** Await the called event's sequence before continuing; false = fire-and-forget. */
    waitUntilFinish: z.boolean().default(false),
  }),
  z.object({ type: z.literal('resetAllDevices') }),
  /**
   * Game over: resets every device, records the verdict for the operation
   * screen, and ends the session.
   */
  z.object({ type: z.literal('endTheme'), verdict: z.enum(['success', 'fail']) }),
  z.object({
    type: z.literal('adjustTimer'),
    adjustment: z.union([
      z.object({ deltaMs: z.number().int() }),
      z.object({ action: z.enum(['pause', 'resume']) }),
    ]),
  }),
  z.object({
    type: z.literal('eval'),
    /** Runs in the server node:vm sandbox. Returning false stops the sequence. */
    code: z.string(),
  }),
  /** Shows a toast on the operation screen to alert the operators. */
  z.object({ type: z.literal('notify'), message: z.string() }),
  /** Displays the hint asset's entry code as an overlay on the device screen. */
  z.object({ type: z.literal('showHintCode'), hintId: assetRef, deviceId: assetRef }),
  z.object({
    type: z.literal('hideHintCode'),
    deviceId: assetRef,
    /** Hide on every device; deviceId is ignored when set. */
    allDevices: z.boolean().default(false),
  }),
]);
export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command['type'];

/**
 * Asset-id reference fields per command type, for consumers that must walk or
 * rewrite refs (e.g. theme duplication's id remap). The `satisfies` clause
 * makes adding a command type a compile error until it is listed here.
 */
export const COMMAND_ASSET_REFS = {
  resetDevice: ['deviceId'],
  playDialogue: ['dialogueId', 'playerId'],
  stopDialogue: ['playerId'],
  playSfx: ['sfxId', 'playerId'],
  stopSfx: ['playerId'],
  playVideo: ['videoId', 'playerId'],
  stopVideo: ['playerId'],
  playBgm: ['bgmId', 'playerId'],
  stopBgm: ['playerId'],
  wait: [],
  navigate: ['deviceId', 'websiteId'],
  sendMessage: ['deviceId', 'messageId'],
  switchPhase: ['phaseId'],
  callEvent: ['eventId'],
  resetAllDevices: [],
  endTheme: [],
  adjustTimer: [],
  eval: [],
  notify: [],
  showHintCode: ['hintId', 'deviceId'],
  hideHintCode: ['deviceId'],
} as const satisfies Record<CommandType, readonly string[]>;

/** Each entry carries a stable id so the editor can reorder without losing identity. */
export const SequenceEntrySchema = z.intersection(
  z.object({ id: z.uuid() }),
  CommandSchema,
);
export type SequenceEntry = z.infer<typeof SequenceEntrySchema>;

export const SequenceSchema = z.array(SequenceEntrySchema);
export type Sequence = z.infer<typeof SequenceSchema>;
