import { z } from 'zod';
import { JsonValueSchema } from './json.js';

/**
 * Sequence command definitions. The runtime (M2) executes these on the server;
 * the editor (M3) authors them. Stored as a JSON array on Event.sequence.
 */
export const CommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('resetDevice'), deviceId: z.uuid() }),
  z.object({
    type: z.literal('playDialogue'),
    dialogueId: z.uuid(),
    playerId: z.uuid(),
    waitUntilEnd: z.boolean(),
  }),
  z.object({ type: z.literal('stopDialogue'), playerId: z.uuid() }),
  z.object({ type: z.literal('playSfx'), sfxId: z.uuid(), playerId: z.uuid() }),
  z.object({ type: z.literal('stopSfx'), playerId: z.uuid() }),
  z.object({
    type: z.literal('playVideo'),
    videoId: z.uuid(),
    playerId: z.uuid(),
    waitUntilEnd: z.boolean(),
  }),
  z.object({ type: z.literal('stopVideo'), playerId: z.uuid() }),
  z.object({
    type: z.literal('playBgm'),
    bgmId: z.uuid(),
    playerId: z.uuid(),
    loop: z.boolean(),
  }),
  z.object({ type: z.literal('stopBgm'), playerId: z.uuid() }),
  z.object({ type: z.literal('wait'), durationMs: z.number().int().positive() }),
  z.object({ type: z.literal('navigate'), deviceId: z.uuid(), websiteId: z.uuid() }),
  z.object({
    type: z.literal('sendMessage'),
    deviceId: z.uuid(),
    messageId: z.uuid(),
    /** Concrete values for the message asset's field schema, entered in the editor. */
    values: z.record(z.string(), JsonValueSchema),
  }),
  z.object({ type: z.literal('switchPhase'), phaseId: z.uuid() }),
  z.object({ type: z.literal('callEvent'), eventId: z.uuid() }),
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
