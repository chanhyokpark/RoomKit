import { z } from 'zod';
import {
  AssetKindSchema,
  AssetSchema,
  CreateAssetInputSchema,
  UpdateAssetInputSchema,
  type Asset,
} from '@roomkit/shared';
import { defineTool } from '../registry.js';
import { requireTheme } from '../session.js';

/**
 * Token-lean listing shape: full `data` (sequences, dialogue lines, ...) can
 * be huge, so lists carry a per-kind digest instead. get_asset returns it all.
 */
function summarize(asset: Asset) {
  const base = {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    code: asset.code,
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

export const assetTools = [
  defineTool({
    name: 'list_assets',
    description:
      'List the theme\'s assets (defaults to the selected theme), optionally filtered by kind or tag. Returns per-kind summaries; set includeData for full data payloads (verbose — prefer get_asset for one asset).',
    inputSchema: z.object({
      themeId: z.uuid().optional(),
      kind: AssetKindSchema.optional(),
      tagId: z.uuid().optional(),
      includeData: z.boolean().default(false),
    }),
    handler: async ({ themeId, kind, tagId, includeData }, ctx) => {
      const assets = await ctx.api.api(
        `/themes/${requireTheme(ctx.state, themeId)}/assets`,
        { query: { kind, tagId }, schema: z.array(AssetSchema) },
      );
      return includeData ? assets : assets.map(summarize);
    },
  }),

  defineTool({
    name: 'get_asset',
    description: 'Fetch one asset with its full data payload. Defaults to the selected theme.',
    inputSchema: z.object({ themeId: z.uuid().optional(), assetId: z.uuid() }),
    handler: ({ themeId, assetId }, ctx) =>
      ctx.api.api(`/themes/${requireTheme(ctx.state, themeId)}/assets/${assetId}`, {
        schema: AssetSchema,
      }),
  }),

  defineTool({
    name: 'create_asset',
    description:
      'Create an asset in the theme (defaults to the selected theme). `asset` is the full create payload — call describe_asset_kind first for the kind\'s data shape. For event assets prefer an empty sequence here, then set_event_sequence.',
    inputSchema: z.object({
      themeId: z.uuid().optional(),
      asset: CreateAssetInputSchema,
    }),
    handler: ({ themeId, asset }, ctx) =>
      ctx.api.api(`/themes/${requireTheme(ctx.state, themeId)}/assets`, {
        method: 'POST',
        body: asset,
        schema: AssetSchema,
      }),
  }),

  defineTool({
    name: 'update_asset',
    description:
      'Update an asset. WARNING: `data` is a full replacement validated against the asset\'s kind — read the asset first and send the complete payload, never a partial merge. `code` applies to device/hint kinds only. For event sequences prefer set_event_sequence. Defaults to the selected theme.',
    inputSchema: UpdateAssetInputSchema.extend({
      themeId: z.uuid().optional(),
      assetId: z.uuid(),
    }),
    handler: ({ themeId, assetId, ...patch }, ctx) =>
      ctx.api.api(`/themes/${requireTheme(ctx.state, themeId)}/assets/${assetId}`, {
        method: 'PATCH',
        body: patch,
        schema: AssetSchema,
      }),
  }),

  defineTool({
    name: 'delete_asset',
    description:
      'PERMANENTLY delete an asset. Sequences referencing it keep dangling refs (skipped at runtime). Defaults to the selected theme.',
    inputSchema: z.object({ themeId: z.uuid().optional(), assetId: z.uuid() }),
    handler: async ({ themeId, assetId }, ctx) => {
      await ctx.api.api(`/themes/${requireTheme(ctx.state, themeId)}/assets/${assetId}`, {
        method: 'DELETE',
      });
      return { deleted: assetId };
    },
  }),
];
