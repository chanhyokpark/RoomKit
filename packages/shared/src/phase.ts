import { z } from 'zod';

export const PhaseSchema = z.object({
  id: z.uuid(),
  themeId: z.uuid(),
  name: z.string().min(1),
  order: z.number().int(),
});
export type Phase = z.infer<typeof PhaseSchema>;
