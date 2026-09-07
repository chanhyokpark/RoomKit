import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { bundledSkillDir, readSkillMeta } from './bundled.js';

const LINK_RE = /\]\(([^)]+)\)/g;

describe('bundled skill content', () => {
  const dir = bundledSkillDir();

  it('stamps the CLI version in SKILL.md frontmatter', () => {
    const pkg = JSON.parse(readFileSync(join(dir, '..', '..', 'apps', 'cli', 'package.json'), 'utf8')) as { version: string };
    assert.equal(readSkillMeta(dir)?.version, pkg.version, 'skills/roomkit/SKILL.md metadata.roomkit-cli-version must match apps/cli/package.json');
  });

  it('has no broken relative links', () => {
    const files = ['SKILL.md', ...readdirSync(join(dir, 'references')).map((f) => `references/${f}`)];
    const broken: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const m of text.matchAll(LINK_RE)) {
        const target = m[1]!;
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        const path = target.split('#')[0]!;
        if (!path) continue;
        if (!existsSync(resolve(dirname(join(dir, file)), path))) broken.push(`${file}: ${target}`);
      }
    }
    assert.deepEqual(broken, []);
  });
});
