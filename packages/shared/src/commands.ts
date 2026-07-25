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
 *
 * Every command except playDialogue is defined in `nonDialogueOptions` so it
 * can double as a dialogue line cue (see {@link DialogueLineCueSchema});
 * playDialogue itself is excluded from cues — starting a dialogue would stop
 * the one the cue is running inside of (callEvent is the escape hatch) — which
 * also keeps the schema non-recursive.
 */
const nonDialogueOptions = [
  z.object({ type: z.literal('resetDevice'), deviceId: assetRef }),
  z.object({
    type: z.literal('stopDialogue'),
    playerId: assetRef,
    /** Stop on every player; playerId is ignored when set. */
    allPlayers: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('playSfx'),
    sfxId: assetRef,
    playerId: assetRef,
    waitUntilEnd: z.boolean().default(false),
  }),
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
    /** Ignored when loop is on (looping playback never "ends"). */
    waitUntilEnd: z.boolean().default(false),
  }),
  z.object({
    type: z.literal('stopBgm'),
    playerId: assetRef,
    /** Stop on every player; playerId is ignored when set. */
    allPlayers: z.boolean().default(false),
  }),
  z.object({ type: z.literal('wait'), durationMs: z.number().int().positive() }),
  z.object({
    type: z.literal('navigate'),
    deviceId: assetRef,
    websiteId: assetRef,
    /**
     * Query params appended to the website URL. Array of pairs (not a record)
     * so the editor tolerates in-progress duplicate keys. Values support
     * {{vars.x}} / {{payload.x}} interpolation at resolve time.
     */
    query: z.array(z.object({ key: z.string(), value: z.string() })).default([]),
  }),
  z.object({
    type: z.literal('sendMessage'),
    deviceId: assetRef,
    messageId: assetRef,
    /**
     * Concrete values for the message asset's field schema, entered in the
     * editor. String values support {{vars.x}} / {{payload.x}} interpolation
     * at resolve time; an exact-match template keeps the variable's JSON type.
     */
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
] as const;

/** Commands allowed inside a dialogue line cue: everything but playDialogue. */
export const DialogueCueCommandSchema = z.discriminatedUnion(
  'type',
  nonDialogueOptions,
);
export type DialogueCueCommand = z.infer<typeof DialogueCueCommandSchema>;

/** Cue entries carry a stable id, like sequence entries (editor identity). */
export const DialogueCueEntrySchema = z.intersection(
  z.object({ id: z.uuid() }),
  DialogueCueCommandSchema,
);
export type DialogueCueEntry = z.infer<typeof DialogueCueEntrySchema>;

/**
 * Commands wedged into the gap after one dialogue line. The speaker pauses
 * before the next line, the server runs `sequence` in order, then playback
 * continues. Anchored to the line's stable id so cues survive line reorder in
 * the asset editor; a cue whose line no longer exists (or is the last line —
 * no gap follows) is skipped with a warning at runtime.
 */
export const DialogueLineCueSchema = z.object({
  afterLineId: z.uuid(),
  sequence: z.array(DialogueCueEntrySchema),
});
export type DialogueLineCue = z.infer<typeof DialogueLineCueSchema>;

export const CommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('playDialogue'),
    dialogueId: assetRef,
    playerId: assetRef,
    waitUntilEnd: z.boolean(),
    /** Commands to run between lines; waitUntilEnd spans cue time too. */
    lineCues: z.array(DialogueLineCueSchema).default([]),
  }),
  ...nonDialogueOptions,
]);
export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command['type'];

/**
 * Asset-id reference fields per command type, for consumers that must walk or
 * rewrite refs (e.g. theme duplication's id remap). The `satisfies` clause
 * makes adding a command type a compile error until it is listed here.
 *
 * Lists direct fields only: playDialogue's nested lineCues sequences must be
 * walked recursively by the consumer (each cue entry is itself a command).
 * A cue's afterLineId is a dialogue *line* id, not an asset id — line ids are
 * copied verbatim by duplication/import, so it never needs remapping.
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
