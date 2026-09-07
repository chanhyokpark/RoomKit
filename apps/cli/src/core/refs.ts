import { z } from 'zod';
import {
  AssetSchema,
  COMMAND_ASSET_REFS,
  TagSchema,
  type Asset,
  type AssetKind,
  type Tag,
  type Theme,
} from '@roomkit/shared';
import type { OpsContext } from './context.js';
import { REF_FIELD_KINDS } from './schemas.js';
import { ToolError } from './session.js';

/**
 * Human-friendly references. Stored data always holds uuids (they cross the
 * wire to devices and the client libraries validate them), so every tool
 * input that names an asset/tag/theme is resolved to a uuid here before it
 * is validated or sent. A uuid passes through untouched; anything else is
 * matched against the theme's assets by key, code, then name.
 */
export const isUuid = (value: string): boolean => z.uuid().safeParse(value).success;

export const AssetRefSchema = z
  .string()
  .min(1)
  .describe('Asset reference: uuid, key, code (device/hint), or unique name');
export const TagRefSchema = z.string().min(1).describe('Tag reference: uuid or unique name');
export const ThemeRefSchema = z
  .string()
  .min(1)
  .describe('Theme reference: uuid or unique name. Omit to use the project theme (roomkit.json / --theme).');

const REF_DESCRIPTION = 'uuid, key, code, or unique name';

/** Short label for error messages and the `refs` legend of sequence tools. */
export function assetLabel(asset: Pick<Asset, 'kind' | 'name' | 'key' | 'code'>): string {
  const extras = [asset.key && `key=${asset.key}`, asset.code && `code=${asset.code}`].filter(Boolean);
  return `${asset.kind} "${asset.name}"${extras.length ? ` (${extras.join(', ')})` : ''}`;
}

/**
 * Pure matching rule for asset references (unit-tested). `kind` narrows the
 * candidates when the referencing field implies one (sfxId → sfx); a match
 * of the wrong kind is reported instead of silently resolving.
 */
export function matchAsset(assets: Asset[], ref: string, kind?: AssetKind, where = 'asset'): Asset {
  if (isUuid(ref)) {
    const byId = assets.find((a) => a.id === ref);
    if (byId && kind && byId.kind !== kind) {
      throw new ToolError(`${where}: ${assetLabel(byId)} is not a ${kind}.`);
    }
    // Unknown uuids are left to the caller (dangling refs are warnings, not errors).
    return byId ?? ({ id: ref, kind: kind ?? 'event', name: ref, key: null, code: null } as Asset);
  }
  const pool = kind ? assets.filter((a) => a.kind === kind) : assets;
  const lower = ref.toLowerCase();
  const stages: Array<(a: Asset) => boolean> = [
    (a) => a.key === ref,
    (a) => a.code === ref,
    (a) => a.name === ref,
    (a) => a.name.toLowerCase() === lower,
  ];
  for (const stage of stages) {
    const matches = pool.filter(stage);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new ToolError(
        `${where}: "${ref}" is ambiguous — ${matches.map((a) => `${assetLabel(a)} id=${a.id}`).join('; ')}. Use the id or give the asset a unique key.`,
      );
    }
  }
  if (kind) {
    const otherKind = assets.filter((a) => a.kind !== kind && stages.some((s) => s(a)));
    if (otherKind.length) {
      throw new ToolError(
        `${where}: "${ref}" matches ${otherKind.map(assetLabel).join(', ')} but a ${kind} asset is expected.`,
      );
    }
  }
  throw new ToolError(
    `${where}: no ${kind ?? 'asset'} matches "${ref}" (looked up by ${REF_DESCRIPTION}). Run \`rk asset list${kind ? ` --kind ${kind}` : ''}\` to see what exists.`,
  );
}

export function matchTag(tags: Tag[], ref: string): Tag {
  if (isUuid(ref)) {
    const tag = tags.find((t) => t.id === ref);
    if (!tag) throw new ToolError(`No tag with id ${ref}. Run \`rk tag list\`.`);
    return tag;
  }
  const exact = tags.filter((t) => t.name === ref);
  const matches = exact.length ? exact : tags.filter((t) => t.name.toLowerCase() === ref.toLowerCase());
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new ToolError(`Tag name "${ref}" is ambiguous: ${matches.map((t) => t.id).join(', ')}`);
  }
  throw new ToolError(
    `No tag matches "${ref}". Available: ${tags.map((t) => t.name).join(', ') || '(none)'}`,
  );
}

/** uuid → exact id; otherwise exact name, then a unique case-insensitive substring. */
export function matchTheme(themes: Theme[], ref: string): Theme {
  let theme = isUuid(ref) ? themes.find((t) => t.id === ref) : undefined;
  if (!theme) {
    theme = themes.find((t) => t.name === ref);
    if (!theme) {
      const matches = themes.filter((t) => t.name.toLowerCase().includes(ref.toLowerCase()));
      if (matches.length === 1) theme = matches[0];
      else if (matches.length > 1) {
        throw new ToolError(`Theme name "${ref}" is ambiguous: ${matches.map((t) => t.name).join(', ')}`);
      }
    }
  }
  if (!theme) {
    throw new ToolError(
      `Theme not found. Available: ${themes.map((t) => `${t.name} (${t.id})`).join(', ') || '(none)'}`,
    );
  }
  return theme;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * One theme's assets, fetched once per tool call, with reference resolution
 * over raw (pre-validation) JSON so that keys/names inside sequences and
 * asset data become uuids before the strict shared schemas see them.
 */
export class ThemeIndex {
  private tags: Tag[] | null = null;
  private readonly byId: Map<string, Asset>;

  constructor(
    private readonly ctx: OpsContext,
    readonly themeId: string,
    readonly assets: Asset[],
  ) {
    this.byId = new Map(assets.map((a) => [a.id, a]));
  }

  static async load(ctx: OpsContext, themeId: string): Promise<ThemeIndex> {
    const assets = await ctx.api.api(`/themes/${themeId}/assets`, { schema: z.array(AssetSchema) });
    return new ThemeIndex(ctx, themeId, assets);
  }

  get(id: string): Asset | undefined {
    return this.byId.get(id);
  }

  resolveAsset(ref: string, kind?: AssetKind, where = 'asset'): Asset {
    return matchAsset(this.assets, ref, kind, where);
  }

  resolveAssetId(ref: string, kind?: AssetKind, where = 'asset'): string {
    return this.resolveAsset(ref, kind, where).id;
  }

  /** Null / non-string values pass through (validation reports them). */
  private resolveValue(value: unknown, kind: AssetKind | undefined, where: string): unknown {
    return typeof value === 'string' ? this.resolveAssetId(value, kind, where) : value;
  }

  async resolveTagIds(refs: string[] | undefined): Promise<string[] | undefined> {
    if (!refs) return undefined;
    this.tags ??= await this.ctx.api.api(`/themes/${this.themeId}/tags`, { schema: z.array(TagSchema) });
    return refs.map((ref) => matchTag(this.tags!, ref).id);
  }

  /** `refs` legend entry for a uuid found in stored data. */
  label(id: string): string {
    const asset = this.byId.get(id);
    return asset ? assetLabel(asset) : `(no asset with id ${id})`;
  }

  /** Resolves the asset-reference fields of one command (and its line cues). */
  resolveCommand(command: unknown, where: string): unknown {
    if (!isRecord(command)) return command;
    const out: Record<string, unknown> = { ...command };
    const type = command.type;
    if (typeof type === 'string' && type in COMMAND_ASSET_REFS) {
      for (const field of COMMAND_ASSET_REFS[type as keyof typeof COMMAND_ASSET_REFS]) {
        out[field] = this.resolveValue(command[field], REF_FIELD_KINDS[field], `${where}.${field}`);
      }
    }
    if (type === 'playDialogue' && Array.isArray(command.lineCues)) {
      out.lineCues = command.lineCues.map((cue: unknown, cueIndex: number) =>
        isRecord(cue) && Array.isArray(cue.sequence)
          ? { ...cue, sequence: this.resolveSequence(cue.sequence, `${where}.lineCues[${cueIndex}]`) }
          : cue,
      );
    }
    return out;
  }

  resolveSequence(sequence: unknown[], where = 'sequence'): unknown[] {
    return sequence.map((entry, i) => this.resolveCommand(entry, `${where}[${i}]`));
  }

  /** Resolves references inside an asset's `data` payload for its kind. */
  resolveAssetData(kind: AssetKind, data: unknown): unknown {
    if (!isRecord(data)) return data;
    switch (kind) {
      case 'player':
        return {
          ...data,
          speakerDeviceId: this.resolveValue(data.speakerDeviceId, 'device', 'data.speakerDeviceId'),
          screenDeviceId: this.resolveValue(data.screenDeviceId, 'device', 'data.screenDeviceId'),
        };
      case 'device':
        return isRecord(data.startWebsite)
          ? {
              ...data,
              startWebsite: {
                ...data.startWebsite,
                websiteId: this.resolveValue(data.startWebsite.websiteId, 'website', 'data.startWebsite.websiteId'),
              },
            }
          : data;
      case 'event': {
        const out: Record<string, unknown> = {
          ...data,
          phaseId: this.resolveValue(data.phaseId, 'phase', 'data.phaseId'),
        };
        if (Array.isArray(data.sequence)) out.sequence = this.resolveSequence(data.sequence, 'data.sequence');
        return out;
      }
      default:
        return data;
    }
  }

  /** Every asset uuid referenced by a (validated) sequence, labelled. */
  legend(sequence: unknown[]): Record<string, string> {
    const legend: Record<string, string> = {};
    const walk = (entries: unknown[]) => {
      for (const entry of entries) {
        if (!isRecord(entry)) continue;
        const type = entry.type;
        if (typeof type === 'string' && type in COMMAND_ASSET_REFS) {
          for (const field of COMMAND_ASSET_REFS[type as keyof typeof COMMAND_ASSET_REFS]) {
            const value = entry[field];
            if (typeof value === 'string') legend[value] = this.label(value);
          }
        }
        if (type === 'playDialogue' && Array.isArray(entry.lineCues)) {
          for (const cue of entry.lineCues) if (isRecord(cue) && Array.isArray(cue.sequence)) walk(cue.sequence);
        }
      }
    };
    walk(sequence);
    return legend;
  }
}
