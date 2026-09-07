import type { Command } from 'commander';
import pc from 'picocolors';
import { createTag, deleteTag, listTags, updateTag } from '../core/ops/tags.js';
import { ToolError } from '../core/session.js';
import { resolveThemeId } from '../project/theme.js';
import { out, table } from '../ui/output.js';
import { emit, type GetContext } from './util.js';

export function register(program: Command, ctx: GetContext): void {
  const tag = program.command('tag').description('애셋 태그 관리');

  tag
    .command('list')
    .description('테마의 태그')
    .action(async () => {
      const c = ctx();
      const tags = await listTags(c, await resolveThemeId(c));
      emit(c, tags, () => {
        if (!tags.length) return out.info('태그가 없습니다.');
        out.line(table(['이름', '색상', 'ID'], tags.map((t) => [t.name, t.color, t.id])));
      });
    });

  tag
    .command('create <name>')
    .description('태그 만들기')
    .requiredOption('--color <css-color>', '색상 (CSS 색상값, 예: #00cc88)')
    .action(async (name: string, opts: { color: string }) => {
      const c = ctx();
      const t = await createTag(c, await resolveThemeId(c), name, opts.color);
      emit(c, t, () => out.ok(`태그 생성: ${pc.bold(t.name)} ${pc.dim(t.id)}`));
    });

  tag
    .command('update <ref>')
    .description('태그 이름/색상 변경 (uuid 또는 이름)')
    .option('--name <name>')
    .option('--color <css-color>')
    .action(async (ref: string, opts: { name?: string; color?: string }) => {
      const c = ctx();
      if (!opts.name && !opts.color) throw new ToolError('--name 또는 --color 를 지정해 주세요.', 'usage');
      const t = await updateTag(c, await resolveThemeId(c), ref, opts);
      emit(c, t, () => out.ok(`태그 수정: ${pc.bold(t.name)} (${t.color})`));
    });

  tag
    .command('delete <ref>')
    .description('태그 삭제')
    .action(async (ref: string) => {
      const c = ctx();
      const t = await deleteTag(c, await resolveThemeId(c), ref);
      emit(c, { deleted: t.id, name: t.name }, () => out.ok(`태그 삭제: ${t.name}`));
    });
}
