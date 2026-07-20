import { z } from 'zod';

export const TagSchema = z.object({
  id: z.uuid(),
  themeId: z.uuid(),
  name: z.string().min(1),
  color: z.string().min(1),
});
export type Tag = z.infer<typeof TagSchema>;

export const CreateTagInputSchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
});
export type CreateTagInput = z.infer<typeof CreateTagInputSchema>;

export const UpdateTagInputSchema = CreateTagInputSchema.partial();
export type UpdateTagInput = z.infer<typeof UpdateTagInputSchema>;
