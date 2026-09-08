import { z } from 'zod';
import {
  AssetKeySchema,
  AssetKindSchema,
  AssetSchema,
  CreateAssetInputSchema,
  UpdateAssetInputSchema,
  type Asset,
  type AssetKind,
} from '@roomkit/shared';
import type { OpsContext } from '../context.js';
import { TagRefSchema, ThemeIndex } from '../refs.js';

/**
 * Token-lean listing shape: full `data` (sequences, dialogue lines, ...) can
 * be huge, so lists carry a per-kind digest instead. getAsset returns it all.
 */
export function summarizeAsset(asset: Asset) {
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
      return { ...base, phaseId, triggerKind, triggerName, manualTriggerable, once, sequenceLength: asset.data.sequence.length };
    }
    case 'phase':
      return {
        ...base,
        order: asset.data.order,
        registrations: {
          deviceStates: asset.data.deviceStates.length,
          deviceWebsites: asset.data.deviceWebsites.length,
          playerBgms: asset.data.playerBgms.length,
        },
      };
    case 'device':
      return { ...base, displayName: asset.data.displayName, isHintDevice: asset.data.isHintDevice };
    case 'player':
      return { ...base, speakerDeviceId: asset.data.speakerDeviceId, screenDeviceId: asset.data.screenDeviceId };
    case 'website':
      return { ...base, mode: asset.data.mode, ...(asset.data.mode === 'external' && { url: asset.data.url }) };
    case 'dialogue':
      return { ...base, lineCount: asset.data.lines.length };
    case 'hint':
      return { ...base, stepCount: asset.data.steps.length };
    case 'message':
    case 'state':
      return { ...base, fields: asset.data.fields.map((f) => f.key) };
    case 'bgm':
    case 'sfx':
    case 'video':
    case 'image':
    case 'file':
      return { ...base, hasFile: asset.data.fileKey !== null };
  }
}
export type AssetSummary = ReturnType<typeof summarizeAsset>;

/**
 * Create payload with `data`/`tagIds` left loose so key/name references can
 * be resolved to uuids before the strict CreateAssetInputSchema runs.
 */
export const LooseCreateAssetSchema = z.object({
  kind: AssetKindSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  key: AssetKeySchema.nullable().optional(),
  code: z.string().min(1).optional(),
  tagIds: z.array(TagRefSchema).optional(),
  data: z.record(z.string(), z.unknown()),
});
export type LooseCreateAsset = z.infer<typeof LooseCreateAssetSchema>;

export const LooseUpdateAssetSchema = UpdateAssetInputSchema.extend({
  tagIds: z.array(TagRefSchema).optional(),
});
export type LooseUpdateAsset = z.infer<typeof LooseUpdateAssetSchema>;

export interface ListAssetsOptions {
  kind?: AssetKind;
  /** Tag reference (uuid or name). */
  tag?: string;
  /** Case-insensitive substring of name, key, or code. */
  search?: string;
}

export async function listAssets(ctx: OpsContext, themeId: string, opts: ListAssetsOptions = {}): Promise<Asset[]> {
  let tagId = opts.tag;
  if (tagId) {
    const index = new ThemeIndex(ctx, themeId, []);
    tagId = (await index.resolveTagIds([tagId]))![0];
  }
  let assets = await ctx.api.api(`/themes/${themeId}/assets`, {
    query: { kind: opts.kind, tagId },
    schema: z.array(AssetSchema),
  });
  if (opts.search) {
    const needle = opts.search.toLowerCase();
    assets = assets.filter((a) => [a.name, a.key, a.code].some((v) => v && v.toLowerCase().includes(needle)));
  }
  return assets;
}

export async function getAsset(ctx: OpsContext, themeId: string, ref: string, kind?: AssetKind): Promise<Asset> {
  const index = await ThemeIndex.load(ctx, themeId);
  const id = index.resolveAssetId(ref, kind, 'asset');
  return index.get(id) ?? ctx.api.api(`/themes/${themeId}/assets/${id}`, { schema: AssetSchema });
}

export async function createAsset(ctx: OpsContext, themeId: string, asset: LooseCreateAsset): Promise<Asset> {
  const index = await ThemeIndex.load(ctx, themeId);
  const body = CreateAssetInputSchema.parse({
    ...asset,
    data: index.resolveAssetData(asset.kind, asset.data),
    tagIds: await index.resolveTagIds(asset.tagIds),
  });
  return ctx.api.api(`/themes/${themeId}/assets`, { method: 'POST', body, schema: AssetSchema });
}

/** `data`, when given, is a full replacement validated against the asset's kind. */
export async function updateAsset(ctx: OpsContext, themeId: string, ref: string, patch: LooseUpdateAsset): Promise<Asset> {
  const index = await ThemeIndex.load(ctx, themeId);
  const target = index.resolveAsset(ref, undefined, 'asset');
  const body = {
    ...patch,
    ...(patch.data !== undefined && { data: index.resolveAssetData(target.kind, patch.data) }),
    ...(patch.tagIds && { tagIds: await index.resolveTagIds(patch.tagIds) }),
  };
  return ctx.api.api(`/themes/${themeId}/assets/${target.id}`, { method: 'PATCH', body, schema: AssetSchema });
}

export async function deleteAsset(ctx: OpsContext, themeId: string, ref: string): Promise<Asset> {
  const index = await ThemeIndex.load(ctx, themeId);
  const target = index.resolveAsset(ref, undefined, 'asset');
  await ctx.api.api(`/themes/${themeId}/assets/${target.id}`, { method: 'DELETE' });
  return target;
}
