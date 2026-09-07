import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyOps, type LooseEntry } from './sequence-ops.js';
import { ToolError } from './session.js';

const LINE = '9a1a2b3c-4d5e-4f60-8172-83940a5b6c7d';
const base = (): LooseEntry[] => [
  { id: 'a', type: 'wait', durationMs: 100 },
  { id: 'b', type: 'playSfx', sfxId: null, playerId: null, waitUntilEnd: false },
  { id: 'c', type: 'playDialogue', dialogueId: null, playerId: null, waitUntilEnd: true, lineCues: [] },
];
const ids = (list: LooseEntry[]) => list.map((e) => e.id);

describe('applyOps', () => {
  it('does not mutate its input', () => {
    const input = base();
    applyOps(input, [{ op: 'remove', target: 'a' }]);
    assert.deepEqual(ids(input), ['a', 'b', 'c']);
  });

  it('inserts with default append, at, before, after and custom ids', () => {
    const { sequence, results } = applyOps(base(), [
      { op: 'insert', command: { type: 'notify', message: 'x' }, id: 'n1' },
      { op: 'insert', command: { type: 'notify', message: 'y' }, at: 0, id: 'n0' },
      { op: 'insert', command: { type: 'notify', message: 'z' }, before: 'b', id: 'nb' },
      { op: 'insert', command: { type: 'notify', message: 'w' }, after: 2 },
    ]);
    assert.deepEqual(ids(sequence).slice(0, 4), ['n0', 'a', 'nb', results[3]!.id]);
    assert.equal(ids(sequence).at(-1), 'n1');
    assert.match(results[3]!.id, /^[0-9a-f-]{36}$/);
  });

  it('replace keeps the id, update merges fields, and rejects type changes', () => {
    const { sequence } = applyOps(base(), [
      { op: 'replace', target: 'a', command: { type: 'wait', durationMs: 5 } },
      { op: 'update', target: 1, patch: { waitUntilEnd: true } },
    ]);
    assert.deepEqual(sequence[0], { id: 'a', type: 'wait', durationMs: 5 });
    assert.equal(sequence[1]!.waitUntilEnd, true);
    assert.throws(
      () => applyOps(base(), [{ op: 'update', target: 'a', patch: { type: 'notify' } }]),
      /cannot change type/,
    );
  });

  it('moves entries and targets resolve against the current state', () => {
    const { sequence } = applyOps(base(), [
      { op: 'move', target: 'c', at: 0 },
      { op: 'remove', target: 1 }, // 'a' after the move
    ]);
    assert.deepEqual(ids(sequence), ['c', 'b']);
    assert.deepEqual(ids(applyOps(base(), [{ op: 'move', target: 'a', after: 'c' }]).sequence), ['b', 'c', 'a']);
    assert.deepEqual(ids(applyOps(base(), [{ op: 'move', target: 'c', before: 'a' }]).sequence), ['c', 'a', 'b']);
  });

  it('reports the failing op with an outline', () => {
    assert.throws(
      () => applyOps(base(), [{ op: 'remove', target: 'zzz' }]),
      (err: unknown) => err instanceof ToolError && /ops\[0\].*no entry with id "zzz"/.test(err.message) && /\[1\] b playSfx/.test(err.message),
    );
    assert.throws(() => applyOps(base(), [{ op: 'remove', target: 9 }]), /out of range/);
    assert.throws(
      () => applyOps(base(), [{ op: 'insert', command: { type: 'notify' }, at: 0, before: 'a' }]),
      /at most one/,
    );
  });

  it('edits inside a dialogue line cue, creating the cue on insert', () => {
    const scope = { entryId: 'c', afterLineId: LINE };
    const { sequence, results } = applyOps(base(), [
      { op: 'insert', command: { type: 'wait', durationMs: 1 }, id: 'cue1', in: scope },
      { op: 'insert', command: { type: 'wait', durationMs: 2 }, id: 'cue2', in: scope },
      { op: 'move', target: 'cue2', at: 0, in: scope },
    ]);
    const cues = sequence[2]!.lineCues as Array<{ afterLineId: string; sequence: LooseEntry[] }>;
    assert.equal(cues.length, 1);
    assert.equal(cues[0]!.afterLineId, LINE);
    assert.deepEqual(ids(cues[0]!.sequence), ['cue2', 'cue1']);
    assert.match(results[0]!.where, /lineCues/);
    assert.throws(
      () => applyOps(base(), [{ op: 'remove', target: 'x', in: { entryId: 'a', afterLineId: LINE } }]),
      /not playDialogue/,
    );
    assert.throws(
      () => applyOps(base(), [{ op: 'remove', target: 'x', in: scope }]),
      /has no cue after line/,
    );
  });
});
