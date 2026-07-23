import { z } from 'zod';

export const ThemeSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  /** Countdown time limit in milliseconds. Null = theme without a timer. */
  timeLimitMs: z.number().int().positive().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Theme = z.infer<typeof ThemeSchema>;

export const CreateThemeInputSchema = z.object({
  name: z.string().min(1),
  timeLimitMs: z.number().int().positive().nullable().optional(),
});
export type CreateThemeInput = z.infer<typeof CreateThemeInputSchema>;

export const UpdateThemeInputSchema = CreateThemeInputSchema.partial();
export type UpdateThemeInput = z.infer<typeof UpdateThemeInputSchema>;

export const DuplicateThemeInputSchema = z.object({
  /** Name for the copy. Defaults to "<source name> (사본)". */
  name: z.string().min(1).optional(),
});
export type DuplicateThemeInput = z.infer<typeof DuplicateThemeInputSchema>;
