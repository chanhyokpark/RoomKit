import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ToolError } from './session.js';

/**
 * Partial edits of an event sequence, applied in memory by the MCP server
 * (the REST API only replaces whole event data). Entries are handled as raw
 * JSON records: reference resolution, id filling, and schema validation run
 * on the result afterwards, so ops accept the same loose command JSON as
 * set_event_sequence.
 */
export type LooseEntry = Record<string, unknown>;

const TargetSchema = z
  .union([z.string().min(1), z.number().int().nonnegative()])
  .describe('Entry id, or 0-based index in the (current) sequence');

const CueScopeSchema = z
  .object({
    entryId: z.string().min(1).describe('Id of the playDialogue entry owning the cue'),
    afterLineId: z.uuid().describe('Dialogue line id the cue is anchored after'),
  })
  .describe(
    'Apply the op inside a playDialogue line-cue sequence instead of the top-level sequence. insert creates the cue if it does not exist yet.',
  );

const LooseCommandSchema = z
  .record(z.string(), z.unknown())
  .describe('Command JSON per describe_commands; `id` optional (generated). Asset refs may be uuid/key/code/name.');

const placement = {
  at: z.number().int().nonnegative().optional().describe('Index in the resulting list'),
  before: TargetSchema.optional(),
  after: TargetSchema.optional(),
};

export const SequenceOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('insert'),
    command: LooseCommandSchema,
    id: z.string().min(1).optional().describe('Custom entry id (any string unique in the sequence)'),
    ...placement,
    in: CueScopeSchema.optional(),
  }),
  z.object({
    op: z.literal('replace'),
    target: TargetSchema,
    command: LooseCommandSchema.describe('Full replacement command; keeps the old id unless `id` is given'),
    in: CueScopeSchema.optional(),
  }),
  z.object({
    op: z.literal('update'),
    target: TargetSchema,
    patch: z
      .record(z.string(), z.unknown())
      .describe('Fields to shallow-merge into the entry. Cannot change `type` (use replace). `id` renames the entry.'),
    in: CueScopeSchema.optional(),
  }),
  z.object({ op: z.literal('remove'), target: TargetSchema, in: CueScopeSchema.optional() }),
  z.object({
    op: z.literal('move'),
    target: TargetSchema,
    ...placement,
    in: CueScopeSchema.optional(),
  }),
]);
export type SequenceOp = z.infer<typeof SequenceOpSchema>;

export interface OpResult {
  op: SequenceOp['op'];
  /** Where the op landed: top level or a cue path. */
  where: string;
  index: number;
  id: string;
  entry?: LooseEntry;
}

export interface ApplyResult {
  sequence: LooseEntry[];
  results: OpResult[];
}

const idOf = (entry: LooseEntry): string => (typeof entry.id === 'string' ? entry.id : '(no id)');

function outline(list: LooseEntry[]): string {
  return list.map((e, i) => `[${i}] ${idOf(e)} ${String(e.type)}`).join('\n') || '(empty)';
}

function fail(opIndex: number, message: string, list: LooseEntry[]): never {
  throw new ToolError(`ops[${opIndex}]: ${message}\nCurrent entries:\n${outline(list)}`);
}

function indexOf(list: LooseEntry[], target: string | number, opIndex: number): number {
  if (typeof target === 'number') {
    if (target >= list.length) fail(opIndex, `index ${target} is out of range (${list.length} entries)`, list);
    return target;
  }
  const index = list.findIndex((e) => e.id === target);
  if (index === -1) fail(opIndex, `no entry with id "${target}"`, list);
  return index;
}

/** Insertion index for at/before/after (default: append). */
function placementIndex(
  list: LooseEntry[],
  spec: { at?: number; before?: string | number; after?: string | number },
  opIndex: number,
): number {
  const given = [spec.at, spec.before, spec.after].filter((v) => v !== undefined).length;
  if (given > 1) fail(opIndex, 'give at most one of at / before / after', list);
  if (spec.at !== undefined) {
    if (spec.at > list.length) fail(opIndex, `at ${spec.at} is out of range (${list.length} entries)`, list);
    return spec.at;
  }
  if (spec.before !== undefined) return indexOf(list, spec.before, opIndex);
  if (spec.after !== undefined) return indexOf(list, spec.after, opIndex) + 1;
  return list.length;
}

/**
 * Locates the list an op works on: the top-level sequence, or a cue sequence
 * inside a playDialogue entry (created on demand for inserts).
 */
function scopeList(
  sequence: LooseEntry[],
  scope: { entryId: string; afterLineId: string } | undefined,
  opIndex: number,
  create: boolean,
): { list: LooseEntry[]; where: string } {
  if (!scope) return { list: sequence, where: 'sequence' };
  const owner = sequence.find((e) => e.id === scope.entryId);
  if (!owner) fail(opIndex, `in.entryId "${scope.entryId}" matches no top-level entry`, sequence);
  if (owner.type !== 'playDialogue') {
    fail(opIndex, `in.entryId "${scope.entryId}" is a ${String(owner.type)}, not playDialogue`, sequence);
  }
  if (!Array.isArray(owner.lineCues)) owner.lineCues = [];
  const cues = owner.lineCues as Array<Record<string, unknown>>;
  let cue = cues.find((c) => c && c.afterLineId === scope.afterLineId);
  if (!cue) {
    if (!create) {
      fail(
        opIndex,
        `entry "${scope.entryId}" has no cue after line ${scope.afterLineId} (existing: ${cues.map((c) => String(c.afterLineId)).join(', ') || 'none'})`,
        sequence,
      );
    }
    cue = { afterLineId: scope.afterLineId, sequence: [] };
    cues.push(cue);
  }
  if (!Array.isArray(cue.sequence)) cue.sequence = [];
  return { list: cue.sequence as LooseEntry[], where: `${scope.entryId}.lineCues[afterLineId=${scope.afterLineId}]` };
}

/** Applies ops in order; each op sees the result of the previous ones. Input is not mutated. */
export function applyOps(input: LooseEntry[], ops: SequenceOp[]): ApplyResult {
  const sequence = structuredClone(input);
  const results: OpResult[] = [];

  ops.forEach((op, opIndex) => {
    const { list, where } = scopeList(sequence, op.in, opIndex, op.op === 'insert');
    switch (op.op) {
      case 'insert': {
        const index = placementIndex(list, op, opIndex);
        const entry: LooseEntry = { ...op.command, id: op.id ?? op.command.id ?? randomUUID() };
        list.splice(index, 0, entry);
        results.push({ op: op.op, where, index, id: idOf(entry), entry });
        break;
      }
      case 'replace': {
        const index = indexOf(list, op.target, opIndex);
        const entry: LooseEntry = { ...op.command, id: op.command.id ?? list[index]!.id };
        list[index] = entry;
        results.push({ op: op.op, where, index, id: idOf(entry), entry });
        break;
      }
      case 'update': {
        const index = indexOf(list, op.target, opIndex);
        const current = list[index]!;
        if (op.patch.type !== undefined && op.patch.type !== current.type) {
          fail(opIndex, `update cannot change type (${String(current.type)} → ${String(op.patch.type)}); use replace`, list);
        }
        const entry: LooseEntry = { ...current, ...op.patch };
        list[index] = entry;
        results.push({ op: op.op, where, index, id: idOf(entry), entry });
        break;
      }
      case 'remove': {
        const index = indexOf(list, op.target, opIndex);
        const [removed] = list.splice(index, 1);
        results.push({ op: op.op, where, index, id: idOf(removed!) });
        break;
      }
      case 'move': {
        const from = indexOf(list, op.target, opIndex);
        const [entry] = list.splice(from, 1);
        let to: number;
        try {
          to = placementIndex(list, op, opIndex);
        } catch (err) {
          list.splice(from, 0, entry!);
          throw err;
        }
        list.splice(to, 0, entry!);
        results.push({ op: op.op, where, index: to, id: idOf(entry!) });
        break;
      }
    }
  });

  return { sequence, results };
}
