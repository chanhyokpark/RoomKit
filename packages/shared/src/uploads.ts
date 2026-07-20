import { z } from 'zod';

export const PresignUploadInputSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
});
export type PresignUploadInput = z.infer<typeof PresignUploadInputSchema>;

export const PresignUploadResponseSchema = z.object({
  /** S3 object key to reference as fileKey/imageKey in asset data. */
  key: z.string().min(1),
  /** Presigned PUT URL. The upload must send the exact contentType signed. */
  url: z.url(),
  /** Seconds until the URL expires. */
  expiresIn: z.number().int().positive(),
});
export type PresignUploadResponse = z.infer<typeof PresignUploadResponseSchema>;
