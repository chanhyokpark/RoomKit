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

// Zip imports (M6). The server receives the zip, extracts it, and pushes
// entries to S3 file by file — unlike single-file uploads, which are presigned.

/** Media kinds accepted by the bulk zip import endpoint. */
export const BulkUploadKindSchema = z.enum(['bgm', 'sfx', 'video', 'dialogue']);
export type BulkUploadKind = z.infer<typeof BulkUploadKindSchema>;

export const BulkUploadResultSchema = z.object({
  created: z.array(
    z.object({
      assetId: z.uuid(),
      name: z.string(),
      /** Zip entry paths that fed this asset (1 for media, N for grouped dialogue). */
      files: z.array(z.string()),
    }),
  ),
  skipped: z.array(z.object({ file: z.string(), reason: z.string() })),
});
export type BulkUploadResult = z.infer<typeof BulkUploadResultSchema>;

export const SiteUploadResponseSchema = z.object({
  /** Persist as WebsiteData.sitePrefix (mode: 'hosted'). */
  sitePrefix: z.string().min(1),
  fileCount: z.number().int().nonnegative(),
  /** Single wrapping root folder that was detected and stripped, if any. */
  strippedRoot: z.string().nullable(),
});
export type SiteUploadResponse = z.infer<typeof SiteUploadResponseSchema>;
