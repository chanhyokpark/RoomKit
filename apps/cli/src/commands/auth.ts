import type { Command } from 'commander';
import pc from 'picocolors';
import { z } from 'zod';
import type { CliContext } from '../context.js';
import { CREDENTIALS_PATH, deleteCredentials, loadCredentials } from '../core/creds.js';
import { normalizeServerUrl } from '../core/http.js';
import { listSessions } from '../core/ops/sessions.js';
import { listThemes } from '../core/ops/themes.js';
import { ToolError } from '../core/session.js';
import { skillStatus } from '../skill/install.js';
import { kv, out, shortId, table } from '../ui/output.js';
import { password as promptPassword, text } from '../ui/prompt.js';
import { CLI_VERSION } from '../version.js';
import { emit, type GetContext } from './util.js';

export async function runLogin(ctx: CliContext, opts: { save: boolean }): Promise<{ apiUrl: string; adminId: string; themes: Array<{ id: string; name: string }> }> {
  const saved = loadCredentials();
  const flags = ctx.flags;
  let url = flags.url ?? process.env.ROOMKIT_URL;
  let id = flags.id ?? process.env.ROOMKIT_ID;
  let password = flags.password ?? process.env.ROOMKIT_PASSWORD;

  if (!ctx.interactive()) {
    url ??= saved?.url;
    id ??= saved?.id;
    password ??= saved?.password;
    if (!url || !id || !password) {
      throw new ToolError('로그인 정보가 없습니다. --url, --id, --password (또는 ROOMKIT_URL/ID/PASSWORD)를 지정해 주세요.', 'missing_input');
    }
  } else {
    url ??= await text(ctx, ['--url'], {
      message: 'RoomKit 서버 주소',
      placeholder: 'http://localhost:3000',
      initialValue: saved?.url,
      validate: (v) => (v.trim() ? undefined : '서버 주소를 입력해 주세요.'),
    });
    id ??= await text(ctx, ['--id'], {
      message: '관리자 ID',
      initialValue: saved?.id ?? 'admin',
      validate: (v) => (v.trim() ? undefined : 'ID를 입력해 주세요.'),
    });
    password ??= await promptPassword(ctx, ['--password'], '비밀번호');
  }

  await ctx.api.login(url, id, password, { save: opts.save });
  const themes = await listThemes(ctx);
  return { apiUrl: ctx.state.apiUrl!, adminId: id, themes: themes.map((t) => ({ id: t.id, name: t.name })) };
}

export function register(program: Command, ctx: GetContext): void {
  program
    .command('login')
    .description('서버에 로그인하고 자격 증명을 저장합니다 (~/.roomkit, MCP 서버와 공유)')
    .option('--no-save', '자격 증명을 저장하지 않음')
    .action(async (opts: { save: boolean }) => {
      const c = ctx();
      const result = await runLogin(c, { save: opts.save });
      emit(c, { loggedIn: true, ...result, credentialsPath: opts.save ? CREDENTIALS_PATH : undefined }, () => {
        out.ok(`${result.apiUrl} 에 ${pc.bold(result.adminId)} 로 로그인했습니다.`);
        if (opts.save) out.line(pc.dim(`자격 증명 저장: ${CREDENTIALS_PATH}`));
        if (result.themes.length) {
          out.line();
          out.line(table(['테마', 'ID'], result.themes.map((t) => [t.name, t.id])));
          out.line();
          out.line(pc.dim('프로젝트 테마 지정: rk init ai 또는 rk theme use <이름>  ·  새 웹사이트 프로젝트: rk init'));
        } else {
          out.line(pc.dim('아직 테마가 없습니다. rk theme create <이름> 으로 만들어 보세요.'));
        }
      });
    });

  program
    .command('logout')
    .description('저장된 자격 증명을 삭제합니다')
    .action(async () => {
      const c = ctx();
      const removed = deleteCredentials();
      emit(c, { loggedOut: removed, credentialsPath: CREDENTIALS_PATH }, () => {
        if (removed) out.ok(`저장된 자격 증명을 삭제했습니다 (${CREDENTIALS_PATH}).`);
        else out.info('저장된 자격 증명이 없습니다.');
      });
    });

  program
    .command('whoami')
    .description('현재 로그인 대상 서버와 관리자 ID를 표시합니다')
    .action(async () => {
      const c = ctx();
      const me = await c.api.api('/auth/me', { schema: z.object({ id: z.string() }) });
      emit(c, { apiUrl: c.state.apiUrl, adminId: me.id }, () => {
        out.line(`${pc.bold(me.id)} @ ${c.state.apiUrl}`);
      });
    });

  program
    .command('status')
    .description('로그인, 프로젝트(roomkit.json), 테마, 활성 세션 등 현재 상태를 표시합니다')
    .action(async () => {
      const c = ctx();
      let loggedIn = true;
      let loginError: string | undefined;
      try {
        await c.api.ensureLogin();
      } catch (err) {
        loggedIn = false;
        loginError = err instanceof Error ? err.message : String(err);
      }
      const project = c.project;
      const theme = project?.config.theme ?? null;
      const serverMismatch =
        loggedIn && project?.config.server && normalizeServerUrl(project.config.server) !== c.state.apiUrl;
      const activeSessions = loggedIn && theme ? await listSessions(c, { themeId: theme.id, activeOnly: true }) : [];
      const skills = project ? await skillStatus(project.root, project.config.ai?.tools ?? []) : [];
      const data = {
        cliVersion: CLI_VERSION,
        loggedIn,
        loginError,
        apiUrl: c.state.apiUrl,
        adminId: c.state.adminId,
        project: project ? { root: project.root, server: project.config.server ?? null, theme, websites: project.config.websites, aiTools: project.config.ai?.tools ?? [] } : null,
        serverMismatch: Boolean(serverMismatch),
        activeSessions: activeSessions.map((s) => ({ id: s.id, mode: s.mode, state: s.state, startedAt: s.startedAt })),
        skills,
      };
      emit(c, data, () => {
        out.line(pc.bold(`rk v${CLI_VERSION}`));
        out.line(
          kv([
            ['로그인', loggedIn ? `${c.state.adminId} @ ${c.state.apiUrl}` : pc.red(`아니오 (${loginError})`)],
            ['프로젝트', project ? project.root : pc.dim('없음 (roomkit.json 미발견)')],
            ['테마', theme ? `${theme.name} ${pc.dim(theme.id)}` : pc.dim('미지정')],
          ]),
        );
        if (serverMismatch) out.warn(`roomkit.json server(${project!.config.server})가 로그인 서버와 다릅니다.`);
        if (project?.config.websites.length) {
          out.line();
          out.line(pc.bold('웹사이트'));
          out.line(table(['이름', '디렉터리', '애셋', 'dist'], project.config.websites.map((w) => [w.name, w.dir, w.assetKey ?? shortId(w.assetId), w.dist])));
        }
        if (skills.length) {
          out.line();
          out.line(pc.bold('AI 스킬'));
          out.line(table(['도구', '설치', '버전'], skills.map((s) => [s.tool, s.installed ? '예' : '아니오', s.version ?? '-'])));
        }
        if (activeSessions.length) {
          out.line();
          out.line(pc.bold('활성 세션'));
          out.line(table(['ID', '모드', '상태'], activeSessions.map((s) => [s.id, s.mode, s.state])));
        }
      });
    });
}
