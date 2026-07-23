import { z } from 'zod';
import { AssetKindSchema } from './assets.js';
import { JsonValueSchema } from './json.js';

/**
 * Portable theme archive (.zip) layout:
 *   manifest.json      — ThemeExportManifest (this schema)
 *   files/<key>        — every file referenced by asset data, stored under
 *                        its manifest key (fileKey/imageKey, plus every
 *                        object under a hosted website's sitePrefix)
 *
 * The importer always mints fresh database ids and file keys; manifest ids
 * only wire up references within the archive. To keep hand-written manifests
 * convenient, an id may be ANY manifest-unique string ("door-device"), not
 * just a uuid — exports simply use the source database ids. Everywhere asset
 * data references another asset (player speaker/screen device ids, event
 * phaseId, sequence command refs) or a tag (tagIds), manifest ids are
 * accepted; an id may be omitted entirely when nothing references the asset
 * or tag. Identity-only uuids inside data (dialogue line ids, sequence entry
 * ids) may be omitted or set to any string — the importer replaces them with
 * fresh uuids. A referenced file missing from the archive imports as a
 * placeholder (null fileKey/imageKey).
 */
export const THEME_EXPORT_FORMAT_VERSION = 1;

export const ThemeExportManifestSchema = z.object({
  formatVersion: z.literal(THEME_EXPORT_FORMAT_VERSION),
  /** ISO timestamp of the export; informational only. */
  exportedAt: z.string(),
  theme: z.object({
    name: z.string().min(1),
    timeLimitMs: z.number().int().positive().nullable(),
  }),
  tags: z.array(
    z.object({
      /** Any manifest-unique string; omit when no asset references the tag. */
      id: z.string().min(1).optional(),
      name: z.string().min(1),
      color: z.string().min(1),
    }),
  ),
  assets: z.array(
    z.object({
      /** Any manifest-unique string; omit when nothing references the asset. */
      id: z.string().min(1).optional(),
      kind: AssetKindSchema,
      name: z.string().min(1),
      description: z.string().default(''),
      code: z.string().nullable().default(null),
      tagIds: z.array(z.string().min(1)).default([]),
      /**
       * Validated per-kind against assetDataSchemas by the importer, after
       * manifest-id references inside it are remapped to fresh uuids.
       */
      data: JsonValueSchema,
    }),
  ),
});
export type ThemeExportManifest = z.infer<typeof ThemeExportManifestSchema>;
