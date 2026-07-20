import { z } from 'zod';
import { JsonValueSchema } from './json.js';

export const LogLevelSchema = z.enum(['info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const LogKindSchema = z.enum([
  'session',
  'phase',
  'timer',
  'trigger',
  'event',
  'command',
  'eval',
  'device',
  'hint',
]);
export type LogKind = z.infer<typeof LogKindSchema>;

export const SessionLogEntrySchema = z.object({
  /** Monotonic per-DB id; doubles as the pagination cursor. */
  id: z.number().int(),
  sessionId: z.uuid(),
  at: z.coerce.date(),
  level: LogLevelSchema,
  kind: LogKindSchema,
  message: z.string(),
  data: JsonValueSchema.nullable(),
});
export type SessionLogEntry = z.infer<typeof SessionLogEntrySchema>;

export const ListLogsQuerySchema = z.object({
  afterId: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});
export type ListLogsQuery = z.infer<typeof ListLogsQuerySchema>;
