import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Asset, Tag, Theme } from '@roomkit/shared';
import { matchAsset, matchTag, matchTheme } from './refs.js';
import { ToolError } from './session.js';

const asset = (partial: Partial<Asset> & Pick<Asset, 'id' | 'kind' | 'name'>): Asset =>
  ({ key: null, code: null, ...partial }) as Asset;

const DOOR = 'a3f1c2d4-0000-4000-8000-000000000001';
const BEEP = 'a3f1c2d4-0000-4000-8000-000000000002';
const BEEP2 = 'a3f1c2d4-0000-4000-8000-000000000003';
const assets: Asset[] = [
  asset({ id: DOOR, kind: 'device', name: 'Door Screen', key: 'door', code: 'DOOR-1' }),
  asset({ id: BEEP, kind: 'sfx', name: 'Beep', key: 'beep' }),
  asset({ id: BEEP2, kind: 'sfx', name: 'beep' }),
  asset({ id: 'a3f1c2d4-0000-4000-8000-000000000004', kind: 'bgm', name: 'Beep' }),
];

describe('matchAsset', () => {
  it('passes uuids through even when unknown', () => {
    const unknown = 'a3f1c2d4-0000-4000-8000-0000000000ff';
    assert.equal(matchAsset(assets, unknown, 'sfx').id, unknown);
    assert.equal(matchAsset(assets, DOOR).id, DOOR);
  });

  it('rejects a known uuid of the wrong kind', () => {
    assert.throws(() => matchAsset(assets, DOOR, 'sfx'), ToolError);
  });

  it('resolves by key, then code, then exact name, then case-insensitive name', () => {
    assert.equal(matchAsset(assets, 'door').id, DOOR);
    assert.equal(matchAsset(assets, 'DOOR-1').id, DOOR);
    assert.equal(matchAsset(assets, 'Door Screen').id, DOOR);
    assert.equal(matchAsset(assets, 'door screen').id, DOOR);
    // key wins over another asset's exact name
    assert.equal(matchAsset(assets, 'beep', 'sfx').id, BEEP);
  });

  it('narrows by kind and reports kind mismatches', () => {
    assert.equal(matchAsset(assets, 'Beep', 'bgm').kind, 'bgm');
    assert.throws(() => matchAsset(assets, 'door', 'sfx'), /a sfx asset is expected/);
  });

  it('reports ambiguity instead of guessing', () => {
    // exact name "Beep" matches an sfx and a bgm when no kind is given
    assert.throws(() => matchAsset(assets, 'Beep'), /ambiguous/);
  });

  it('reports misses with guidance', () => {
    assert.throws(() => matchAsset(assets, 'nope', 'sfx'), /no sfx matches "nope"/);
  });
});

describe('matchTag', () => {
  const tags = [
    { id: 'b3f1c2d4-0000-4000-8000-000000000001', name: 'Audio' },
    { id: 'b3f1c2d4-0000-4000-8000-000000000002', name: 'Video' },
  ] as Tag[];
  it('matches by id or name (case-insensitive)', () => {
    assert.equal(matchTag(tags, 'audio').name, 'Audio');
    assert.equal(matchTag(tags, tags[1]!.id).name, 'Video');
    assert.throws(() => matchTag(tags, 'Lighting'), /No tag matches/);
  });
});

describe('matchTheme', () => {
  const themes = [
    { id: 'c3f1c2d4-0000-4000-8000-000000000001', name: 'Stella' },
    { id: 'c3f1c2d4-0000-4000-8000-000000000002', name: 'Stella (copy)' },
  ] as Theme[];
  it('prefers exact name over substring and flags ambiguous substrings', () => {
    assert.equal(matchTheme(themes, 'Stella').id, themes[0]!.id);
    assert.equal(matchTheme(themes, 'copy').id, themes[1]!.id);
    assert.throws(() => matchTheme(themes, 'stell'), /ambiguous/);
    assert.throws(() => matchTheme(themes, 'c3f1c2d4-0000-4000-8000-0000000000ff'), /not found/);
  });
});
