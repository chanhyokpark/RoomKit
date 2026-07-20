import { z } from 'zod';
import { SequenceSchema } from './commands.js';

export const TriggerKindSchema = z.enum(['device', 'manual', 'system']);
export type TriggerKind = z.infer<typeof TriggerKindSchema>;

/** System trigger hook names (triggerName when triggerKind = system). */
export const SystemTriggerSchema = z.enum([
  'session:start',
  'phase:enter',
  'phase:leave',
  'timer:expired',
]);
export type SystemTrigger = z.infer<typeof SystemTriggerSchema>;

export const EventSchema = z.object({
  id: z.uuid(),
  themeId: z.uuid(),
  /** Null = common event, valid in every phase. */
  phaseId: z.uuid().nullable(),
  name: z.string().min(1),
  triggerKind: TriggerKindSchema,
  /** Device event name (device) or system hook name (system); null for manual. */
  triggerName: z.string().nullable(),
  manualTriggerable: z.boolean(),
  /** Re-entry of a running event is blocked by default. */
  allowReentry: z.boolean(),
  sequence: SequenceSchema,
});
export type Event = z.infer<typeof EventSchema>;
