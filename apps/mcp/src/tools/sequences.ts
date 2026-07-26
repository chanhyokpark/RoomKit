import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AssetSchema,
  COMMAND_ASSET_REFS,
  SequenceSchema,
  type Asset,
  type Sequence,
} from '@roomkit/shared';
import { defineTool } from '../registry.js';
import { REF_FIELD_KINDS } from '../schemas.js';
import { requireTheme, ToolError } from '../session.js';
import type { ToolContext } from '../registry.js';

/**
 * Sequence entries as agents write them: full command JSON, `id` optional
 * (missing ids — including dialogue line-cue entry ids — are generated before
 * validation). Kept loose here so validation errors come from the real
 * SequenceSchema, which produces precise per-field messages.
 */
const LooseSequenceSchema = z
  .array(z.record(z.string(), z.unknown()))
  .describe(
    'Array of command entries per describe_commands; entry `id`s may be omitted (generated automatically).',
  );

function fillIds(entries: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return entries.map((entry) => {
    const filled: Record<string, unknown> = { id: randomUUID(), ...entry };
    if (filled.type === 'playDialogue' && Array.isArray(filled.lineCues)) {
      filled.lineCues = filled.lineCues.map((cue) =>
        cue && typeof cue === 'object' && Array.isArray((cue as { sequence?: unknown }).sequence)
          ? { ...cue, sequence: fillIds((cue as { sequence: Array<Record<string, unknown>> }).sequence) }
          : cue,
      );
    }
    return filled;
  });
}

function parseSequence(raw: Array<Record<string, unknown>>): Sequence {
  return SequenceSchema.parse(fillIds(raw));
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

async function fetchEventAsset(ctx: ToolContext, themeId: string, eventId: string) {
  const asset = await ctx.api.api(`/themes/${themeId}/assets/${eventId}`, {
    schema: AssetSchema,
  });
  if (asset.kind !== 'event') {
    throw new ToolError(`Asset "${asset.name}" is kind ${asset.kind}, not an event.`);
  }
  return asset;
}

export const sequenceTools = [
  defineTool({
    name: 'get_event_sequence',
    description:
      'Fetch an event asset\'s full data: trigger config and the command sequence. Defaults to the selected theme.',
    inputSchema: z.object({ themeId: z.uuid().optional(), eventId: z.uuid() }),
    handler: async ({ themeId, eventId }, ctx) => {
      const asset = await fetchEventAsset(ctx, requireTheme(ctx.state, themeId), eventId);
      return { eventId: asset.id, name: asset.name, data: asset.data };
    },
  }),

  defineTool({
    name: 'set_event_sequence',
    description:
      'Replace an event\'s command sequence (trigger config is preserved). Entry ids may be omitted — they are generated. Validates the JSON against the command schema (see describe_commands) and returns warnings for dangling/null/mis-kinded asset references, which the runtime would silently skip. Defaults to the selected theme.',
    inputSchema: z.object({
      themeId: z.uuid().optional(),
      eventId: z.uuid(),
      sequence: LooseSequenceSchema,
    }),
    handler: async ({ themeId, eventId, sequence }, ctx) => {
      const resolvedThemeId = requireTheme(ctx.state, themeId);
      const parsed = parseSequence(sequence);
      const [event, assets] = await Promise.all([
        fetchEventAsset(ctx, resolvedThemeId, eventId),
        ctx.api.api(`/themes/${resolvedThemeId}/assets`, { schema: z.array(AssetSchema) }),
      ]);
      const warnings = checkRefs(parsed, assets);
      const saved = await ctx.api.api(`/themes/${resolvedThemeId}/assets/${eventId}`, {
        method: 'PATCH',
        body: { data: { ...event.data, sequence: parsed } },
        schema: AssetSchema,
      });
      return {
        saved: true,
        eventId: saved.id,
        entryCount: parsed.length,
        warnings,
        sequence: parsed,
      };
    },
  }),

  defineTool({
    name: 'validate_sequence',
    description:
      'Dry-run validation of a sequence: schema check plus asset-reference warnings, without writing anything. Defaults to the selected theme for ref checks.',
    inputSchema: z.object({
      themeId: z.uuid().optional(),
      sequence: LooseSequenceSchema,
    }),
    handler: async ({ themeId, sequence }, ctx) => {
      const parsed = parseSequence(sequence);
      const assets = await ctx.api.api(
        `/themes/${requireTheme(ctx.state, themeId)}/assets`,
        { schema: z.array(AssetSchema) },
      );
      return { valid: true, entryCount: parsed.length, warnings: checkRefs(parsed, assets), sequence: parsed };
    },
  }),
];
