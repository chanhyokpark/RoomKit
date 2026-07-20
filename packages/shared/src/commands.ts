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
  z.object({ type: z.literal('stopDialogue'), playerId: assetRef }),
  z.object({ type: z.literal('playSfx'), sfxId: assetRef, playerId: assetRef }),
  z.object({ type: z.literal('stopSfx'), playerId: assetRef }),
  z.object({
    type: z.literal('playVideo'),
    videoId: assetRef,
    playerId: assetRef,
    waitUntilEnd: z.boolean(),
  }),
  z.object({ type: z.literal('stopVideo'), playerId: assetRef }),
  z.object({
    type: z.literal('playBgm'),
    bgmId: assetRef,
    playerId: assetRef,
    loop: z.boolean(),
  }),
  z.object({ type: z.literal('stopBgm'), playerId: assetRef }),
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
  z.object({ type: z.literal('callEvent'), eventId: assetRef }),
  z.object({ type: z.literal('resetAllDevices') }),
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
]);
export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command['type'];

/** Each entry carries a stable id so the editor can reorder without losing identity. */
export const SequenceEntrySchema = z.intersection(
  z.object({ id: z.uuid() }),
  CommandSchema,
);
export type SequenceEntry = z.infer<typeof SequenceEntrySchema>;

export const SequenceSchema = z.array(SequenceEntrySchema);
export type Sequence = z.infer<typeof SequenceSchema>;
