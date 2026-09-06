import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AssetSchema,
  COMMAND_ASSET_REFS,
  SequenceSchema,
  type Asset,
  type Sequence,
} from '@roomkit/shared';
import { AssetRefSchema, resolveThemeId, ThemeIndex, ThemeRefSchema } from '../refs.js';
import { defineTool } from '../registry.js';
import { REF_FIELD_KINDS } from '../schemas.js';
import { applyOps, SequenceOpSchema, type LooseEntry } from '../sequence-ops.js';
import { ToolError } from '../session.js';
import type { ToolContext } from '../registry.js';

/**
 * Sequence entries as agents write them: full command JSON, `id` optional
 * (missing ids — including dialogue line-cue entry ids — are generated before
 * validation) and asset references as uuid, key, code, or name. Kept loose
 * here so validation errors come from the real SequenceSchema, which produces
 * precise per-field messages.
 */
const LooseSequenceSchema = z
  .array(z.record(z.string(), z.unknown()))
  .describe(
    'Array of command entries per describe_commands. Entry `id`s may be omitted (generated) or be any string unique in the sequence ("open-door"). Asset reference fields accept a uuid, key, code, or unique name.',
  );

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
function checkRefs(sequence: Sequence, assets: Asset[]): string[] {
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

  sequence.forEach((entry, i) =>
    checkCommand(entry as unknown as Record<string, unknown>, `sequence[${i}]`),
  );
  return warnings;
}

/**
 * One line per entry — the cheap way to find edit targets: index, id, type,
 * every asset ref rendered through the legend, and cue sizes.
 */
function outline(sequence: Sequence, index: ThemeIndex): string[] {
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
        parts.push(`lineCues: ${cues.map((c) => `after ${c.afterLineId} → ${c.sequence.length} entr${c.sequence.length === 1 ? 'y' : 'ies'} [${c.sequence.map((e) => String((e as { id: string }).id)).join(', ')}]`).join('; ')}`);
      }
    }
    return parts.join(' ');
  });
}

async function loadEvent(ctx: ToolContext, themeRef: string | undefined, eventRef: string) {
  const themeId = await resolveThemeId(ctx, themeRef);
  const index = await ThemeIndex.load(ctx, themeId);
  const asset = index.resolveAsset(eventRef, 'event', 'eventId');
  const event = index.get(asset.id) ?? (await ctx.api.api(`/themes/${themeId}/assets/${asset.id}`, { schema: AssetSchema }));
  if (event.kind !== 'event') {
    throw new ToolError(`Asset "${event.name}" is kind ${event.kind}, not an event.`);
  }
  return { themeId, index, event };
}

async function saveSequence(ctx: ToolContext, themeId: string, event: Asset & { kind: 'event' }, sequence: Sequence) {
  return ctx.api.api(`/themes/${themeId}/assets/${event.id}`, {
    method: 'PATCH',
    body: { data: { ...event.data, sequence } },
    schema: AssetSchema,
  });
}

const themeArg = { themeId: ThemeRefSchema.optional() };
const eventArg = { eventId: AssetRefSchema.describe('Event asset: uuid, key, or unique name') };

export const sequenceTools = [
  defineTool({
    name: 'get_event_sequence',
    description:
      'Fetch an event asset\'s trigger config and command sequence. view "outline" (recommended before editing) returns one line per entry with index, id, type, and resolved asset labels; view "full" returns the raw sequence JSON plus a `refs` legend mapping every referenced uuid to "kind \\"name\\" (key=…)". Defaults to the selected theme.',
    inputSchema: z.object({
      ...themeArg,
      ...eventArg,
      view: z.enum(['full', 'outline']).default('full'),
    }),
    handler: async ({ themeId, eventId, view }, ctx) => {
      const { index, event } = await loadEvent(ctx, themeId, eventId);
      const { sequence, ...trigger } = event.data;
      const base = { eventId: event.id, name: event.name, key: event.key, trigger, entryCount: sequence.length };
      return view === 'outline'
        ? { ...base, outline: outline(sequence, index) }
        : { ...base, sequence, refs: index.legend(sequence) };
    },
  }),

  defineTool({
    name: 'edit_event_sequence',
    description:
      'Partially edit an event\'s sequence without resending it: an ordered list of ops — insert (command; at | before | after; optional custom id), replace (target, command), update (target, patch — shallow merge, same type), remove (target), move (target; at | before | after). target is an entry id or 0-based index, resolved against the sequence as it is after the previous ops. Add `in: {entryId, afterLineId}` to an op to edit inside a playDialogue line cue (insert creates the cue). The whole result is validated against the command schema and checked for dangling/mis-kinded asset refs (warnings) before saving; nothing is written if any op or validation fails. Returns the affected entries and the new outline, not the full sequence. Asset refs in commands accept uuid, key, code, or unique name. Defaults to the selected theme.',
    inputSchema: z.object({
      ...themeArg,
      ...eventArg,
      ops: z.array(SequenceOpSchema).min(1),
      returnSequence: z.boolean().default(false).describe('Also return the full saved sequence'),
    }),
    handler: async ({ themeId, eventId, ops, returnSequence }, ctx) => {
      const { themeId: resolvedThemeId, index, event } = await loadEvent(ctx, themeId, eventId);
      const { sequence: edited, results } = applyOps(event.data.sequence as unknown as LooseEntry[], ops);
      const parsed = parseSequence(edited, index);
      const warnings = checkRefs(parsed, index.assets);
      const saved = await saveSequence(ctx, resolvedThemeId, event, parsed);
      const savedIds = new Set(results.map((r) => r.id));
      const changed = parsed.filter((entry) => savedIds.has((entry as { id: string }).id));
      return {
        saved: true,
        eventId: saved.id,
        entryCount: parsed.length,
        applied: results.map(({ op, where, index: at, id }) => ({ op, where, index: at, id })),
        changed,
        warnings,
        outline: outline(parsed, index),
        ...(returnSequence && { sequence: parsed }),
      };
    },
  }),

  defineTool({
    name: 'set_event_sequence',
    description:
      'Replace an event\'s whole command sequence (trigger config is preserved). For small changes prefer edit_event_sequence. Entry ids may be omitted (generated) or be any unique string. Asset refs accept uuid, key, code, or unique name. Validates the JSON against the command schema (see describe_commands) and returns warnings for dangling/null/mis-kinded asset references, which the runtime would silently skip. Defaults to the selected theme.',
    inputSchema: z.object({
      ...themeArg,
      ...eventArg,
      sequence: LooseSequenceSchema,
    }),
    handler: async ({ themeId, eventId, sequence }, ctx) => {
      const { themeId: resolvedThemeId, index, event } = await loadEvent(ctx, themeId, eventId);
      const parsed = parseSequence(sequence, index);
      const warnings = checkRefs(parsed, index.assets);
      const saved = await saveSequence(ctx, resolvedThemeId, event, parsed);
      return {
        saved: true,
        eventId: saved.id,
        entryCount: parsed.length,
        warnings,
        outline: outline(parsed, index),
      };
    },
  }),

  defineTool({
    name: 'validate_sequence',
    description:
      'Dry-run validation of a sequence: reference resolution (key/name → uuid), schema check, and asset-reference warnings, without writing anything. Returns the normalized sequence. Defaults to the selected theme for ref checks.',
    inputSchema: z.object({
      ...themeArg,
      sequence: LooseSequenceSchema,
    }),
    handler: async ({ themeId, sequence }, ctx) => {
      const index = await ThemeIndex.load(ctx, await resolveThemeId(ctx, themeId));
      const parsed = parseSequence(sequence, index);
      return { valid: true, entryCount: parsed.length, warnings: checkRefs(parsed, index.assets), sequence: parsed };
    },
  }),
];
