import { z } from 'zod';
import {
  AssetKeySchema,
  AssetKindSchema,
  AssetSchema,
  CreateAssetInputSchema,
  UpdateAssetInputSchema,
  type Asset,
} from '@roomkit/shared';
import { AssetRefSchema, resolveThemeId, TagRefSchema, ThemeIndex, ThemeRefSchema } from '../refs.js';
import { defineTool } from '../registry.js';

/**
 * Token-lean listing shape: full `data` (sequences, dialogue lines, ...) can
 * be huge, so lists carry a per-kind digest instead. get_asset returns it all.
 */
function summarize(asset: Asset) {
  const base = {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    key: asset.key ?? undefined,
    code: asset.code ?? undefined,
    description: asset.description || undefined,
    tags: asset.tags.length ? asset.tags.map((t) => t.name) : undefined,
  };
  switch (asset.kind) {
    case 'event': {
      const { phaseId, triggerKind, triggerName, manualTriggerable, once } = asset.data;
      return {
        ...base,
        phaseId,
        triggerKind,
        triggerName,
        manualTriggerable,
        once,
        sequenceLength: asset.data.sequence.length,
      };
    }
    case 'phase':
      return { ...base, order: asset.data.order };
    case 'device':
      return {
        ...base,
        displayName: asset.data.displayName,
        isHintDevice: asset.data.isHintDevice,
      };
    case 'player':
      return {
        ...base,
        speakerDeviceId: asset.data.speakerDeviceId,
        screenDeviceId: asset.data.screenDeviceId,
      };
    case 'website':
      return { ...base, mode: asset.data.mode };
    case 'dialogue':
      return { ...base, lineCount: asset.data.lines.length };
    case 'hint':
      return { ...base, stepCount: asset.data.steps.length };
    case 'message':
      return { ...base, fields: asset.data.fields.map((f) => f.key) };
    case 'bgm':
    case 'sfx':
    case 'video':
    case 'image':
    case 'file':
      return { ...base, hasFile: asset.data.fileKey !== null };
  }
}

/**
 * Create payload with `data`/`tagIds` left loose so key/name references can
 * be resolved to uuids before the strict CreateAssetInputSchema runs.
 */
const LooseCreateAssetSchema = z
  .object({
    kind: AssetKindSchema,
    name: z.string().min(1),
    description: z.string().optional(),
    key: AssetKeySchema.nullable().optional().describe('Theme-unique slug, e.g. "door-screen"'),
    code: z.string().min(1).optional().describe('device/hint kinds only'),
    tagIds: z.array(TagRefSchema).optional(),
    data: z.record(z.string(), z.unknown()).describe('Per-kind data — see describe_asset_kind'),
  })
  .describe('Create payload per describe_asset_kind; refs inside data may be uuid/key/code/name');

export const assetTools = [
  defineTool({
    name: 'list_assets',
    description:
      'List the theme\'s assets (defaults to the selected theme), optionally filtered by kind, tag, or a name/key substring. Returns per-kind summaries (id, key, name, ...); set includeData for full data payloads (verbose — prefer get_asset for one asset).',
    inputSchema: z.object({
      themeId: ThemeRefSchema.optional(),
      kind: AssetKindSchema.optional(),
      tagId: TagRefSchema.optional(),
      search: z.string().min(1).optional().describe('Case-insensitive substring of name, key, or code'),
      includeData: z.boolean().default(false),
    }),
    handler: async ({ themeId, kind, tagId, search, includeData }, ctx) => {
      const resolvedThemeId = await resolveThemeId(ctx, themeId);
      let resolvedTagId = tagId;
      if (tagId) {
        const index = new ThemeIndex(ctx, resolvedThemeId, []);
        resolvedTagId = (await index.resolveTagIds([tagId]))![0];
      }
      let assets = await ctx.api.api(`/themes/${resolvedThemeId}/assets`, {
        query: { kind, tagId: resolvedTagId },
        schema: z.array(AssetSchema),
      });
      if (search) {
        const needle = search.toLowerCase();
        assets = assets.filter((a) =>
          [a.name, a.key, a.code].some((v) => v && v.toLowerCase().includes(needle)),
        );
      }
      return includeData ? assets : assets.map(summarize);
    },
  }),

  defineTool({
    name: 'get_asset',
    description: 'Fetch one asset with its full data payload. Defaults to the selected theme.',
    inputSchema: z.object({ themeId: ThemeRefSchema.optional(), assetId: AssetRefSchema }),
    handler: async ({ themeId, assetId }, ctx) => {
      const index = await ThemeIndex.load(ctx, await resolveThemeId(ctx, themeId));
      const id = index.resolveAssetId(assetId, undefined, 'assetId');
      return index.get(id) ?? ctx.api.api(`/themes/${index.themeId}/assets/${id}`, { schema: AssetSchema });
    },
  }),

  defineTool({
    name: 'create_asset',
    description:
      'Create an asset in the theme (defaults to the selected theme). `asset` is the full create payload — call describe_asset_kind first for the kind\'s data shape. Give it a `key` (theme-unique slug such as "door-screen") so later tools can reference it without the uuid. Asset references inside data (player speaker/screen devices, event phaseId and sequence refs, device startWebsite) and tagIds accept uuid, key, code, or unique name. For event assets prefer an empty sequence here, then set_event_sequence.',
    inputSchema: z.object({
      themeId: ThemeRefSchema.optional(),
      asset: LooseCreateAssetSchema,
    }),
    handler: async ({ themeId, asset }, ctx) => {
      const index = await ThemeIndex.load(ctx, await resolveThemeId(ctx, themeId));
      const body = CreateAssetInputSchema.parse({
        ...asset,
        data: index.resolveAssetData(asset.kind, asset.data),
        tagIds: await index.resolveTagIds(asset.tagIds),
      });
      return ctx.api.api(`/themes/${index.themeId}/assets`, {
        method: 'POST',
        body,
        schema: AssetSchema,
      });
    },
  }),

  defineTool({
    name: 'update_asset',
    description:
      'Update an asset\'s name/description/key/code/tags and/or data. WARNING: `data` is a full replacement validated against the asset\'s kind — read the asset first and send the complete payload, never a partial merge. `key` is a theme-unique slug (null clears it); `code` applies to device/hint kinds only. References inside data and tagIds accept uuid, key, code, or unique name. For event sequences prefer edit_event_sequence. Defaults to the selected theme.',
    inputSchema: UpdateAssetInputSchema.extend({
      themeId: ThemeRefSchema.optional(),
      assetId: AssetRefSchema,
      tagIds: z.array(TagRefSchema).optional(),
    }),
    handler: async ({ themeId, assetId, ...patch }, ctx) => {
      const index = await ThemeIndex.load(ctx, await resolveThemeId(ctx, themeId));
      const target = index.resolveAsset(assetId, undefined, 'assetId');
      const body = {
        ...patch,
        ...(patch.data !== undefined && { data: index.resolveAssetData(target.kind, patch.data) }),
        ...(patch.tagIds && { tagIds: await index.resolveTagIds(patch.tagIds) }),
      };
      return ctx.api.api(`/themes/${index.themeId}/assets/${target.id}`, {
        method: 'PATCH',
        body,
        schema: AssetSchema,
      });
    },
  }),

  defineTool({
    name: 'delete_asset',
    description:
      'PERMANENTLY delete an asset. Sequences referencing it keep dangling refs (skipped at runtime). Defaults to the selected theme.',
    inputSchema: z.object({ themeId: ThemeRefSchema.optional(), assetId: AssetRefSchema }),
    handler: async ({ themeId, assetId }, ctx) => {
      const index = await ThemeIndex.load(ctx, await resolveThemeId(ctx, themeId));
      const target = index.resolveAsset(assetId, undefined, 'assetId');
      await ctx.api.api(`/themes/${index.themeId}/assets/${target.id}`, { method: 'DELETE' });
      return { deleted: target.id, name: target.name };
    },
  }),
];
