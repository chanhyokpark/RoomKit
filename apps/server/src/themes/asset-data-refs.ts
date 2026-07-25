import { randomUUID } from 'node:crypto';
import {
  assetDataSchemas,
  COMMAND_ASSET_REFS,
  type DialogueData,
  type EventData,
  type HintData,
  type PlayerData,
  type SequenceEntry,
  type WebsiteData,
} from '@roomkit/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

/**
 * Walkers over the per-kind `data` JSON for consumers that must remap what it
 * references: cross-asset ids (duplication, import) and S3 file keys (import).
 * All walkers tolerate legacy/invalid rows by leaving them verbatim, matching
 * the duplicator's copy-don't-fail behavior.
 */

/** Kinds whose `data` carries cross-asset id references. */
const REF_CARRYING_KINDS = ['player', 'event'] as const;
type RefCarryingKind = (typeof REF_CARRYING_KINDS)[number];

/** Cross-asset id references, remapped through `idMap`: player (device ids)
 * and event (phaseId + sequence command refs). */
export function remapAssetData(
  kind: string,
  data: Prisma.JsonValue,
  idMap: Map<string, string>,
): Prisma.InputJsonValue {
  const verbatim = data as Prisma.InputJsonValue;
  if (!(REF_CARRYING_KINDS as readonly string[]).includes(kind))
    return verbatim;

  const parsed = assetDataSchemas[kind as RefCarryingKind].safeParse(data);
  if (!parsed.success) return verbatim;

  switch (kind as RefCarryingKind) {
    case 'player': {
      const player = parsed.data as PlayerData;
      // A dangling source ref stays dangling — same runtime behavior as before.
      return {
        ...player,
        speakerDeviceId:
          idMap.get(player.speakerDeviceId) ?? player.speakerDeviceId,
        screenDeviceId:
          idMap.get(player.screenDeviceId) ?? player.screenDeviceId,
      };
    }
    case 'event': {
      const event = parsed.data as EventData;
      return {
        ...event,
        phaseId:
          event.phaseId === null ? null : (idMap.get(event.phaseId) ?? null),
        sequence: event.sequence.map((entry) =>
          remapSequenceEntry(entry, idMap),
        ),
      };
    }
  }
}

function remapSequenceEntry(
  entry: SequenceEntry,
  idMap: Map<string, string>,
): SequenceEntry {
  const remapped: Record<string, unknown> = { ...entry };
  for (const field of COMMAND_ASSET_REFS[entry.type]) {
    const ref = remapped[field];
    // Refs are nullable in authoring commands; a ref outside the theme maps to
    // null, which the runtime already treats as skip-and-log.
    remapped[field] = typeof ref === 'string' ? (idMap.get(ref) ?? null) : null;
  }
  return remapped as SequenceEntry;
}

/** An asset/tag reference that is neither a manifest id nor uuid-shaped. */
export class UnknownRefError extends Error {
  constructor(public readonly ref: string) {
    super(`Unknown reference "${ref}"`);
  }
}

export const isUuid = (value: string): boolean =>
  z.uuid().safeParse(value).success;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Maps a required asset ref (player device ids). A uuid outside the manifest
 * stays dangling — same tolerance as duplication; any other unknown string is
 * a hand-editing typo and throws.
 */
function mapRequiredRef(ref: unknown, idMap: Map<string, string>): unknown {
  if (typeof ref !== 'string') return ref;
  const mapped = idMap.get(ref);
  if (mapped) return mapped;
  if (isUuid(ref)) return ref;
  throw new UnknownRefError(ref);
}

/** Maps a nullable ref (event phaseId, command refs); dangling uuid → null. */
function mapNullableRef(ref: unknown, idMap: Map<string, string>): unknown {
  if (typeof ref !== 'string') return ref;
  const mapped = idMap.get(ref);
  if (mapped) return mapped;
  if (isUuid(ref)) return null;
  throw new UnknownRefError(ref);
}

/** Identity-only ids (dialogue lines, sequence entries): any non-uuid — or a
 * missing id — becomes a fresh uuid so hand-written manifests can omit them. */
const ensureUuid = (id: unknown): unknown =>
  typeof id === 'string' && isUuid(id) ? id : randomUUID();

/**
 * Rewrites manifest-id references inside raw (pre-validation) asset data to
 * the importer's fresh uuids, so the strict per-kind schemas validate the
 * result. Tolerant of malformed shapes: anything unexpected is left verbatim
 * for validation to report.
 */
export function remapManifestData(
  kind: string,
  data: unknown,
  idMap: Map<string, string>,
): unknown {
  if (!isRecord(data)) return data;
  switch (kind) {
    case 'player':
      return {
        ...data,
        speakerDeviceId: mapRequiredRef(data.speakerDeviceId, idMap),
        screenDeviceId: mapRequiredRef(data.screenDeviceId, idMap),
      };
    case 'event': {
      const out: Record<string, unknown> = {
        ...data,
        phaseId:
          data.phaseId == null ? null : mapNullableRef(data.phaseId, idMap),
      };
      if (Array.isArray(data.sequence)) {
        out.sequence = data.sequence.map((entry: unknown) =>
          remapManifestEntry(entry, idMap),
        );
      }
      return out;
    }
    case 'dialogue': {
      const out: Record<string, unknown> = { ...data };
      if (Array.isArray(data.lines)) {
        out.lines = data.lines.map((line: unknown) =>
          isRecord(line) ? { ...line, id: ensureUuid(line.id) } : line,
        );
      }
      return out;
    }
    default:
      return data;
  }
}

function remapManifestEntry(
  entry: unknown,
  idMap: Map<string, string>,
): unknown {
  if (!isRecord(entry)) return entry;
  const out: Record<string, unknown> = { ...entry, id: ensureUuid(entry.id) };
  const type = entry.type;
  if (typeof type === 'string' && type in COMMAND_ASSET_REFS) {
    for (const field of COMMAND_ASSET_REFS[
      type as keyof typeof COMMAND_ASSET_REFS
    ]) {
      out[field] =
        entry[field] == null ? null : mapNullableRef(entry[field], idMap);
    }
  }
  return out;
}

export interface FileRefs {
  /** Single-object refs: media fileKey, dialogue line fileKey, hint imageKey. */
  keys: string[];
  /** Hosted website prefixes; every object under one belongs to the asset. */
  sitePrefixes: string[];
}

/** S3 references inside `data`, for export packing and import rewriting. */
export function collectFileRefs(kind: string, data: unknown): FileRefs {
  const none: FileRefs = { keys: [], sitePrefixes: [] };
  if (!(kind in assetDataSchemas)) return none;
  const parsed =
    assetDataSchemas[kind as keyof typeof assetDataSchemas].safeParse(data);
  if (!parsed.success) return none;

  switch (kind) {
    case 'bgm':
    case 'sfx':
    case 'video':
    case 'image':
    case 'file': {
      const { fileKey } = parsed.data as { fileKey: string | null };
      return { keys: fileKey ? [fileKey] : [], sitePrefixes: [] };
    }
    case 'dialogue': {
      const dialogue = parsed.data as DialogueData;
      return {
        keys: dialogue.lines.flatMap((l) => (l.fileKey ? [l.fileKey] : [])),
        sitePrefixes: [],
      };
    }
    case 'hint': {
      const hint = parsed.data as HintData;
      return {
        keys: hint.steps.flatMap((s) => (s.imageKey ? [s.imageKey] : [])),
        sitePrefixes: [],
      };
    }
    case 'website': {
      const website = parsed.data as WebsiteData;
      return {
        keys: [],
        sitePrefixes: website.mode === 'hosted' ? [website.sitePrefix] : [],
      };
    }
    default:
      return none;
  }
}

/**
 * Rewrites file refs through the import's old→new maps. A key absent from
 * `keyMap` (file missing from the archive) becomes null — placeholder
 * semantics, same as an asset created without a file.
 */
export function rewriteFileRefs(
  kind: string,
  data: Prisma.InputJsonValue,
  keyMap: Map<string, string>,
  prefixMap: Map<string, string>,
): Prisma.InputJsonValue {
  if (!(kind in assetDataSchemas)) return data;
  const parsed =
    assetDataSchemas[kind as keyof typeof assetDataSchemas].safeParse(data);
  if (!parsed.success) return data;

  switch (kind) {
    case 'bgm':
    case 'sfx':
    case 'video':
    case 'image':
    case 'file': {
      const media = parsed.data as { fileKey: string | null };
      return {
        ...media,
        fileKey: media.fileKey ? (keyMap.get(media.fileKey) ?? null) : null,
      };
    }
    case 'dialogue': {
      const dialogue = parsed.data as DialogueData;
      return {
        ...dialogue,
        lines: dialogue.lines.map((line) => ({
          ...line,
          fileKey: line.fileKey ? (keyMap.get(line.fileKey) ?? null) : null,
        })),
      };
    }
    case 'hint': {
      const hint = parsed.data as HintData;
      return {
        ...hint,
        steps: hint.steps.map((step) => ({
          ...step,
          imageKey: step.imageKey ? (keyMap.get(step.imageKey) ?? null) : null,
        })),
      };
    }
    case 'website': {
      const website = parsed.data as WebsiteData;
      if (website.mode !== 'hosted') return { ...website };
      return {
        ...website,
        sitePrefix: prefixMap.get(website.sitePrefix) ?? website.sitePrefix,
      };
    }
    default:
      return data;
  }
}
