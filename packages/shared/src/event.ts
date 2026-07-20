import { z } from 'zod';

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
