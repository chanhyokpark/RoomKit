import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { installSkill, removeSkill, skillStatus } from './install.js';

describe('skill install (project-scoped)', () => {
  it('installs claude and codex targets, reports status, and removes cleanly', () => {
    const root = mkdtempSync(join(tmpdir(), 'rk-skill-'));
    writeFileSync(join(root, 'AGENTS.md'), '# My project\n\nHouse rules.\n');

    const reports = installSkill(root, ['claude', 'codex', 'cursor']);
    assert.equal(reports.length, 3);
    assert.ok(existsSync(join(root, '.claude/skills/roomkit/SKILL.md')));
    assert.ok(existsSync(join(root, '.agents/skills/roomkit/SKILL.md')));
    assert.ok(existsSync(join(root, '.agents/skills/roomkit/references')));
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    assert.ok(agents.startsWith('# My project\n\nHouse rules.'));
    assert.match(agents, /roomkit-skill:start version=/);
    assert.ok(!existsSync(join(root, '.cursor')), 'cursor reads .agents/skills natively; no rule file');

    const status = skillStatus(root, ['claude', 'codex', 'gemini']);
    assert.deepEqual(status.map((s) => s.installed), [true, true, false]);
    assert.equal(status[0]!.version, reports[0]!.version);

    // Re-install is idempotent for the managed block.
    installSkill(root, ['codex']);
    assert.equal((readFileSync(join(root, 'AGENTS.md'), 'utf8').match(/roomkit-skill:start/g) ?? []).length, 1);

    removeSkill(root, ['codex', 'cursor'], ['claude']);
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), '# My project\n\nHouse rules.\n');
    assert.ok(!existsSync(join(root, '.agents/skills/roomkit')));
        assert.ok(existsSync(join(root, '.claude/skills/roomkit/SKILL.md')));
  });
});
