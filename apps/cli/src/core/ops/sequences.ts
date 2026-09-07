import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AssetSchema, COMMAND_ASSET_REFS, SequenceSchema, type Asset, type Sequence } from '@roomkit/shared';
import type { OpsContext } from '../context.js';
import { ThemeIndex } from '../refs.js';
import { REF_FIELD_KINDS } from '../schemas.js';
import { applyOps, SequenceOpSchema, type LooseEntry, type SequenceOp } from '../sequence-ops.js';
import { ToolError } from '../session.js';

/**
 * Sequence entries as authors write them: full command JSON, `id` optional
 * (missing ids — including dialogue line-cue entry ids — are generated before
 * validation) and asset references as uuid, key, code, or name. Kept loose
 * here so validation errors come from the real SequenceSchema, which produces
 * precise per-field messages.
 */
export const LooseSequenceSchema = z.array(z.record(z.string(), z.unknown()));
export const SequenceOpsSchema = z.array(SequenceOpSchema).min(1);
export type { SequenceOp };

function fillIds(entries: LooseEntry[]): LooseEntry[] {
  return entries.map((entry) => {
    const filled: LooseEntry = { id: randomUUID(), ...entry };
    if (filled.type === 'playDialogue' && Array.isArray(filled.lineCues)) {
      filled.lineCues = filled.lineCues.map((cue) =>
        cue && typeof cue === 'object' && Array.isArray((cue as { sequence?: unknown }).sequence)
          ? { ...cue, sequence: fillIds((cue as { sequence: LooseEntry[] }).sequence) }
          : cue,
      );
    }
    return filled;
  });
}

/** Resolve refs → fill ids → strict schema. Order matters: refs must be uuids before parsing. */
function parseSequence(raw: LooseEntry[], index: ThemeIndex): Sequence {
  return SequenceSchema.parse(fillIds(index.resolveSequence(raw) as LooseEntry[]));
}

/**
 * Cross-checks every asset reference (including inside dialogue line cues)
 * against the theme's assets. Dangling/misplaced refs are warnings, not
 * errors — the runtime skips them silently, so surfacing them here is the
 * only place an author finds out.
 */
export function checkRefs(sequence: Sequence, assets: Asset[]): string[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const warnings: string[] = [];

  const checkCommand = (command: Record<string, unknown>, where: string) => {
    const type = command.type as keyof typeof COMMAND_ASSET_REFS;
    for (const field of COMMAND_ASSET_REFS[type] ?? []) {
      const value = command[field];
      if (value === null) {
        warnings.push(`${where} (${type}): ${field} is null — the command will be skipped at runtime.`);
        continue;
      }
      if (typeof value !== 'string') continue;
      const target = byId.get(value);
      if (!target) {
        warnings.push(`${where} (${type}): ${field} "${value}" matches no asset in this theme — the command will be skipped at runtime.`);
      } else if (REF_FIELD_KINDS[field] && target.kind !== REF_FIELD_KINDS[field]) {
        warnings.push(`${where} (${type}): ${field} points at "${target.name}" (kind ${target.kind}), expected a ${REF_FIELD_KINDS[field]} asset.`);
      }
    }
    if (type === 'playDialogue') {
      const dialogue = typeof command.dialogueId === 'string' ? byId.get(command.dialogueId) : undefined;
      const lines = dialogue?.kind === 'dialogue' ? dialogue.data.lines : null;
      const cues = command.lineCues as Array<{ afterLineId: string; sequence: Sequence }>;
      cues.forEach((cue, cueIndex) => {
        if (lines) {
          const lineIndex = lines.findIndex((l) => l.id === cue.afterLineId);
          if (lineIndex === -1) {
            warnings.push(`${where} (playDialogue): lineCues[${cueIndex}].afterLineId matches no line of "${dialogue!.name}" — the cue will be skipped.`);
          } else if (lineIndex === lines.length - 1) {
            warnings.push(`${where} (playDialogue): lineCues[${cueIndex}] is anchored to the last line — no gap follows, the cue never runs.`);
          }
        }
        cue.sequence.forEach((entry, i) =>
          checkCommand(entry as unknown as Record<string, unknown>, `${where} cue[${cueIndex}].sequence[${i}]`),
        );
      });
    }
  };

  sequence.forEach((entry, i) => checkCommand(entry as unknown as Record<string, unknown>, `sequence[${i}]`));
  return warnings;
}

/**
 * One line per entry — the cheap way to find edit targets: index, id, type,
 * every asset ref rendered through the legend, and cue sizes.
 */
export function outlineSequence(sequence: Sequence, index: ThemeIndex): string[] {
  return sequence.map((entry, i) => {
    const record = entry as unknown as Record<string, unknown>;
    const type = record.type as keyof typeof COMMAND_ASSET_REFS;
    const parts = [`[${i}] id=${String(record.id)} ${String(type)}`];
    for (const field of COMMAND_ASSET_REFS[type] ?? []) {
      const value = record[field];
      parts.push(`${field}=${typeof value === 'string' ? index.label(value) : 'null'}`);
    }
    for (const [key, value] of Object.entries(record)) {
      if (key === 'id' || key === 'type' || key === 'lineCues' || (COMMAND_ASSET_REFS[type] as readonly string[])?.includes(key)) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        parts.push(`${key}=${typeof value === 'string' ? JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value) : String(value)}`);
      }
    }
    if (type === 'playDialogue') {
      const cues = record.lineCues as Array<{ afterLineId: string; sequence: Sequence }>;
      if (cues.length) {
        parts.push(
          `lineCues: ${cues.map((c) => `after ${c.afterLineId} → ${c.sequence.length} entr${c.sequence.length === 1 ? 'y' : 'ies'} [${c.sequence.map((e) => String((e as { id: string }).id)).join(', ')}]`).join('; ')}`,
        );
      }
    }
    return parts.join(' ');
  });
}

type EventAsset = Asset & { kind: 'event' };

async function loadEvent(ctx: OpsContext, themeId: string, eventRef: string) {
  const index = await ThemeIndex.load(ctx, themeId);
  const asset = index.resolveAsset(eventRef, 'event', 'event');
  const event = index.get(asset.id) ?? (await ctx.api.api(`/themes/${themeId}/assets/${asset.id}`, { schema: AssetSchema }));
  if (event.kind !== 'event') {
    throw new ToolError(`Asset "${event.name}" is kind ${event.kind}, not an event.`, 'wrong_kind');
  }
  return { index, event: event as EventAsset };
}

function saveSequence(ctx: OpsContext, themeId: string, event: EventAsset, sequence: Sequence) {
  return ctx.api.api(`/themes/${themeId}/assets/${event.id}`, {
    method: 'PATCH',
    body: { data: { ...event.data, sequence } },
    schema: AssetSchema,
  });
}

export async function getEventSequence(ctx: OpsContext, themeId: string, eventRef: string, view: 'full' | 'outline') {
  const { index, event } = await loadEvent(ctx, themeId, eventRef);
  const { sequence, ...trigger } = event.data;
  const base = { eventId: event.id, name: event.name, key: event.key, trigger, entryCount: sequence.length };
  return view === 'outline'
    ? { ...base, outline: outlineSequence(sequence, index) }
    : { ...base, sequence, refs: index.legend(sequence) };
}

export async function editEventSequence(
  ctx: OpsContext,
  themeId: string,
  eventRef: string,
  ops: SequenceOp[],
  returnSequence = false,
) {
  const { index, event } = await loadEvent(ctx, themeId, eventRef);
  const { sequence: edited, results } = applyOps(event.data.sequence as unknown as LooseEntry[], ops);
  const parsed = parseSequence(edited, index);
  const warnings = checkRefs(parsed, index.assets);
  const saved = await saveSequence(ctx, themeId, event, parsed);
  const savedIds = new Set(results.map((r) => r.id));
  const changed = parsed.filter((entry) => savedIds.has((entry as { id: string }).id));
  return {
    saved: true as const,
    eventId: saved.id,
    entryCount: parsed.length,
    applied: results.map(({ op, where, index: at, id }) => ({ op, where, index: at, id })),
    changed,
    warnings,
    outline: outlineSequence(parsed, index),
    ...(returnSequence && { sequence: parsed }),
  };
}

export async function setEventSequence(ctx: OpsContext, themeId: string, eventRef: string, sequence: LooseEntry[]) {
  const { index, event } = await loadEvent(ctx, themeId, eventRef);
  const parsed = parseSequence(sequence, index);
  const warnings = checkRefs(parsed, index.assets);
  const saved = await saveSequence(ctx, themeId, event, parsed);
  return { saved: true as const, eventId: saved.id, entryCount: parsed.length, warnings, outline: outlineSequence(parsed, index) };
}

export async function validateSequence(ctx: OpsContext, themeId: string, sequence: LooseEntry[]) {
  const index = await ThemeIndex.load(ctx, themeId);
  const parsed = parseSequence(sequence, index);
  return { valid: true as const, entryCount: parsed.length, warnings: checkRefs(parsed, index.assets), sequence: parsed };
}
