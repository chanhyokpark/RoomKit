import type { Command } from 'commander';
import pc from 'picocolors';
import type { CliContext } from '../context.js';
import { exportTheme, importTheme } from '../core/ops/archive.js';
import { createTheme, deleteTheme, duplicateTheme, findTheme, listThemes, updateTheme } from '../core/ops/themes.js';
import { ToolError } from '../core/session.js';
import { emptyConfig, saveProject } from '../project/config.js';
import { resolveTheme, resolveThemeId } from '../project/theme.js';
import { parseDuration } from '../ui/json-input.js';
import { kv, out, table } from '../ui/output.js';
import { confirm } from '../ui/prompt.js';
import { emit, fmtDate, type GetContext } from './util.js';

/** Writes the theme (and server) into roomkit.json, creating the file at cwd when there is none. */
export async function useTheme(ctx: CliContext, theme: { id: string; name: string }): Promise<string> {
  let project = ctx.project;
  if (!project) {
    const root = process.cwd();
    if (!ctx.yes && ctx.interactive()) {
      const ok = await confirm(ctx, `roomkit.json 이 없습니다. ${root} 에 새로 만들까요?`, true);
      if (!ok) throw new ToolError('cancelled', 'cancelled');
    }
    project = saveProject(root, emptyConfig());
  }
  await ctx.api.ensureLogin();
  saveProject(project.root, { ...project.config, server: ctx.state.apiUrl ?? project.config.server, theme: { id: theme.id, name: theme.name } });
  ctx.reloadProject();
  return project.root;
}

function timeLimitOption(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === 'none' || value === 'null' || value === '0') return null;
  return parseDuration(value, '--time-limit');
}

const fmtLimit = (ms: number | null) => (ms === null ? pc.dim('없음') : `${Math.round(ms / 60000)}분`);

export function register(program: Command, ctx: GetContext): void {
  const theme = program.command('theme').description('테마 관리 (list/use/create/update/delete/duplicate/export/import)');

  theme
    .command('list')
    .description('서버의 모든 테마')
    .action(async () => {
      const c = ctx();
      const themes = await listThemes(c);
      const current = c.project?.config.theme?.id;
      emit(c, themes, () => {
        if (!themes.length) return out.info('테마가 없습니다. rk theme create <이름> 으로 만들어 보세요.');
        out.line(table(['', '이름', '제한시간', 'ID'], themes.map((t) => [t.id === current ? pc.green('●') : '', t.name, fmtLimit(t.timeLimitMs), t.id])));
      });
    });

  theme
    .command('use [ref]')
    .description('프로젝트 테마를 roomkit.json 에 기록합니다 (uuid 또는 이름; 생략 시 선택)')
    .action(async (ref?: string) => {
      const c = ctx();
      const t = await resolveTheme(c, ref);
      const root = await useTheme(c, t);
      emit(c, { theme: { id: t.id, name: t.name }, projectRoot: root }, () => {
        out.ok(`프로젝트 테마: ${pc.bold(t.name)} ${pc.dim(t.id)} → ${root}/roomkit.json`);
      });
    });

  theme
    .command('get [ref]')
    .description('테마 정보')
    .action(async (ref?: string) => {
      const c = ctx();
      const t = await resolveTheme(c, ref);
      emit(c, t, () => out.line(kv([['이름', t.name], ['ID', t.id], ['제한시간', fmtLimit(t.timeLimitMs)], ['생성', fmtDate(t.createdAt)], ['수정', fmtDate(t.updatedAt)]])));
    });

  theme
    .command('create <name>')
    .description('새 테마 만들기')
    .option('--time-limit <duration>', '제한시간 (예: 60m, 3600000; none = 없음)')
    .option('--use', '만든 테마를 프로젝트 테마로 지정')
    .action(async (name: string, opts: { timeLimit?: string; use?: boolean }) => {
      const c = ctx();
      const t = await createTheme(c, { name, timeLimitMs: timeLimitOption(opts.timeLimit) ?? null });
      if (opts.use) await useTheme(c, t);
      emit(c, t, () => {
        out.ok(`테마 생성: ${pc.bold(t.name)} ${pc.dim(t.id)}`);
        if (opts.use) out.line(pc.dim('roomkit.json 에 프로젝트 테마로 기록했습니다.'));
      });
    });

  theme
    .command('update [ref]')
    .description('테마 이름/제한시간 변경')
    .option('--name <name>', '새 이름')
    .option('--time-limit <duration>', '제한시간 (예: 60m; none = 없음)')
    .action(async (ref: string | undefined, opts: { name?: string; timeLimit?: string }) => {
      const c = ctx();
      const timeLimitMs = timeLimitOption(opts.timeLimit);
      if (opts.name === undefined && timeLimitMs === undefined) throw new ToolError('--name 또는 --time-limit 를 지정해 주세요.', 'usage');
      const id = await resolveThemeId(c, ref);
      const t = await updateTheme(c, id, { ...(opts.name !== undefined && { name: opts.name }), ...(timeLimitMs !== undefined && { timeLimitMs }) });
      const project = c.project;
      if (project?.config.theme?.id === t.id && project.config.theme.name !== t.name) {
        saveProject(project.root, { ...project.config, theme: { id: t.id, name: t.name } });
      }
      emit(c, t, () => out.ok(`테마 수정: ${pc.bold(t.name)} (제한시간 ${fmtLimit(t.timeLimitMs)})`));
    });

  theme
    .command('delete <ref>')
    .description('테마와 모든 애셋/세션을 영구 삭제합니다')
    .action(async (ref: string) => {
      const c = ctx();
      const t = await findTheme(c, ref);
      const ok = await confirm(c, `테마 "${t.name}" (${t.id}) 와 모든 애셋·세션을 삭제할까요? 되돌릴 수 없습니다.`);
      if (!ok) throw new ToolError('cancelled', 'cancelled');
      await deleteTheme(c, t.id);
      const project = c.project;
      if (project?.config.theme?.id === t.id) {
        const { theme: _drop, ...rest } = project.config;
        saveProject(project.root, rest as typeof project.config);
        c.warn('roomkit.json 의 프로젝트 테마를 비웠습니다.');
      }
      emit(c, { deleted: t.id, name: t.name }, () => out.ok(`테마 삭제: ${t.name}`));
    });

  theme
    .command('duplicate [ref]')
    .description('테마 복제 (애셋/태그 포함, 파일은 공유)')
    .option('--name <name>', '복제본 이름')
    .option('--use', '복제본을 프로젝트 테마로 지정')
    .action(async (ref: string | undefined, opts: { name?: string; use?: boolean }) => {
      const c = ctx();
      const id = await resolveThemeId(c, ref);
      const t = await duplicateTheme(c, id, opts.name);
      if (opts.use) await useTheme(c, t);
      emit(c, t, () => out.ok(`테마 복제: ${pc.bold(t.name)} ${pc.dim(t.id)}`));
    });

  theme
    .command('export [ref]')
    .description('테마 아카이브(zip) 내려받기')
    .option('-o, --output <file>', '저장 경로 (기본: <테마이름>.zip)')
    .action(async (ref: string | undefined, opts: { output?: string }) => {
      const c = ctx();
      const t = await resolveTheme(c, ref);
      const dest = opts.output ?? `${t.name.replace(/[\\/:*?"<>|]+/g, '_')}.zip`;
      const result = await exportTheme(c, t.id, dest);
      emit(c, { theme: { id: t.id, name: t.name }, ...result }, () => out.ok(`내보내기: ${result.path} (${(result.bytes / 1024 / 1024).toFixed(1)} MB)`));
    });

  theme
    .command('import <zip>')
    .description('테마 아카이브(zip)를 새 테마로 가져오기')
    .option('--use', '가져온 테마를 프로젝트 테마로 지정')
    .action(async (zip: string, opts: { use?: boolean }) => {
      const c = ctx();
      const t = await importTheme(c, zip);
      if (opts.use) await useTheme(c, t);
      emit(c, t, () => out.ok(`가져오기: ${pc.bold(t.name)} ${pc.dim(t.id)}`));
    });
}
