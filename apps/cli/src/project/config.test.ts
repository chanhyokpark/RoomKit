import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ToolError } from '../core/session.js';
import { emptyConfig, findProject, findProjectRoot, saveProject, upsertWebsite } from './config.js';

const THEME = 'a3f1c2d4-0000-4000-8000-000000000001';
const SITE = 'a3f1c2d4-0000-4000-8000-000000000002';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'rk-config-'));
}

describe('roomkit.json', () => {
  it('is found by walking up from a nested directory', () => {
    const root = tmp();
    writeFileSync(join(root, 'roomkit.json'), JSON.stringify({ version: 1 }));
    const nested = join(root, 'apps', 'site');
    mkdirSync(nested, { recursive: true });
    assert.equal(findProjectRoot(nested), root);
    assert.equal(findProject(undefined, nested)?.root, root);
  });

  it('returns null when there is no project and errors for a wrong explicit path', () => {
    const root = tmp();
    assert.equal(findProject(undefined, root), null);
    assert.throws(() => findProject(join(root, 'nope'), root), ToolError);
  });

  it('round-trips with a stable key order and keeps unknown keys', () => {
    const root = tmp();
    const config = upsertWebsite(
      { ...emptyConfig(), theme: { id: THEME, name: 'T' }, server: 'http://x', custom: 1 } as never,
      { name: 'main', dir: '.', assetId: SITE, assetKey: 'main', build: 'pnpm build', dist: 'dist' },
    );
    saveProject(root, config);
    const text = readFileSync(join(root, 'roomkit.json'), 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(text)), ['version', 'server', 'theme', 'websites', 'custom']);
    const loaded = findProject(root)!;
    assert.equal(loaded.config.websites[0]!.name, 'main');
    assert.equal((loaded.config as Record<string, unknown>).custom, 1);
  });

  it('replaces a website entry by name', () => {
    const config = upsertWebsite(
      upsertWebsite(emptyConfig(), { name: 'a', dir: '.', assetId: SITE, dist: 'dist' }),
      { name: 'a', dir: 'apps/a', assetId: SITE, dist: 'build' },
    );
    assert.equal(config.websites.length, 1);
    assert.equal(config.websites[0]!.dist, 'build');
  });

  it('rejects an invalid file with a readable error', () => {
    const root = tmp();
    writeFileSync(join(root, 'roomkit.json'), JSON.stringify({ version: 2 }));
    assert.throws(() => findProject(undefined, root), /roomkit.json is invalid/);
  });

  it('keeps dev/test fields and orders them stably', () => {
    const root = tmp();
    const site = { name: 'main', dir: '.', assetId: SITE, assetKey: 'main', build: 'pnpm build', dist: 'dist', dev: { command: 'pnpm dev', url: 'http://localhost:5173' } };
    saveProject(root, { ...emptyConfig(), theme: { id: THEME, name: 'T' }, ai: { tools: ['claude'] }, test: { devices: ['screen'] }, websites: [site] });
    const raw = readFileSync(join(root, 'roomkit.json'), 'utf8');
    assert.deepEqual(Object.keys(JSON.parse(raw)), ['version', 'theme', 'websites', 'test', 'ai']);
    const loaded = findProject(undefined, root)!;
    assert.deepEqual(loaded.config.websites[0]!.dev, { command: 'pnpm dev', url: 'http://localhost:5173' });
    assert.deepEqual(loaded.config.test, { devices: ['screen'] });
  });

  it('rejects a dev block without a valid url', () => {
    const root = tmp();
    writeFileSync(join(root, 'roomkit.json'), JSON.stringify({ version: 1, websites: [{ name: 'a', dir: '.', assetId: SITE, dist: 'dist', dev: { url: 'nope' } }] }));
    assert.throws(() => findProject(undefined, root), ToolError);
  });
});
