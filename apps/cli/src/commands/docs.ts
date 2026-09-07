import type { Command } from 'commander';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { normalizeDocname, readRemoteDoc } from '../core/docs.js';
import { ToolError } from '../core/session.js';
import { bundledSkillDir, readSkillMeta } from '../skill/bundled.js';
import { out } from '../ui/output.js';
import { emit, type GetContext } from './util.js';

function listBundled(): string[] {
  const dir = bundledSkillDir();
  const refs = readdirSync(join(dir, 'references')).filter((f) => f.endsWith('.md')).sort();
  return ['SKILL.md', ...refs.map((f) => `references/${f}`)];
}

export function register(program: Command, ctx: GetContext): void {
  const docs = program.command('docs').description('AI/개발자용 문서 (CLI에 번들된 roomkit 스킬; --remote 로 GitHub master 최신본)');

  docs
    .command('list')
    .description('문서 목록 (SKILL.md 본문 포함)')
    .option('--remote', 'GitHub master 의 SKILL.md 를 읽음')
    .action(async (opts: { remote?: boolean }) => {
      const c = ctx();
      const skillText = opts.remote ? await readRemoteDoc('SKILL.md') : readFileSync(join(bundledSkillDir(), 'SKILL.md'), 'utf8');
      const files = opts.remote ? undefined : listBundled();
      const meta = readSkillMeta(bundledSkillDir());
      emit(c, { source: opts.remote ? 'remote' : 'bundled', skillVersion: meta?.version ?? null, files, skill: skillText }, () => {
        if (files) {
          out.line(pc.bold('문서 파일'));
          for (const f of files) out.line(`  ${f}`);
          out.line();
        }
        out.line(skillText);
      });
    });

  docs
    .command('read <name>')
    .description('문서 하나 읽기 (예: references/helper.md)')
    .option('--remote', 'GitHub master 에서 읽음')
    .action(async (name: string, opts: { remote?: boolean }) => {
      const c = ctx();
      let content: string;
      if (opts.remote) content = await readRemoteDoc(name);
      else {
        const rel = decodeURIComponent(normalizeDocname(name));
        try {
          content = readFileSync(join(bundledSkillDir(), rel), 'utf8');
        } catch {
          throw new ToolError(`문서를 찾을 수 없습니다: ${rel} (rk docs list 로 목록 확인)`, 'not_found');
        }
      }
      emit(c, { name, content }, () => out.line(content));
    });
}
