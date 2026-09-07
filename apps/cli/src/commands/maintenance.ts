import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import pc from 'picocolors';
import { CREDENTIALS_PATH, loadCredentials } from '../core/creds.js';
import { ToolError } from '../core/session.js';
import { bundledSkillVersion, skillStatus } from '../skill/install.js';
import { checkForUpdate } from '../update/check.js';
import { kv, out } from '../ui/output.js';
import { confirm } from '../ui/prompt.js';
import { CLI_VERSION, installCommand } from '../version.js';
import { emit, type GetContext } from './util.js';

function run(command: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { stdio: 'inherit', shell: true });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function versionOf(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout?.on('data', (c: Buffer) => (output += c.toString()));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? output.trim() : null));
  });
}

export function register(program: Command, ctx: GetContext): void {
  program
    .command('version')
    .description('CLI 버전 (--check 로 최신 버전 확인)')
    .option('--check', 'GitHub master 의 최신 버전과 비교')
    .action(async (opts: { check?: boolean }) => {
      const c = ctx();
      const info = opts.check ? await checkForUpdate({ force: true }) : null;
      emit(c, { version: CLI_VERSION, skillVersion: bundledSkillVersion(), update: info }, () => {
        out.line(`rk v${CLI_VERSION}`);
        if (opts.check) {
          if (!info) out.warn('최신 버전을 확인하지 못했습니다 (네트워크).');
          else if (info.outdated) out.warn(`새 버전 v${info.latest} 이 있습니다. 업데이트: rk upgrade`);
          else out.ok(`최신 버전입니다 (master: v${info.latest}).`);
        }
      });
    });

  program
    .command('upgrade')
    .description('CLI 를 GitHub 의 최신 버전으로 다시 설치합니다')
    .option('--ref <ref>', '특정 브랜치/태그/커밋으로 설치')
    .option('--print', '실행하지 않고 명령만 출력')
    .action(async (opts: { ref?: string; print?: boolean }) => {
      const c = ctx();
      const command = installCommand(opts.ref);
      if (opts.print || c.json) return emit(c, { command }, () => out.line(command));
      out.line(pc.dim(`$ ${command}`));
      const code = await run(command);
      if (code !== 0) throw new ToolError(`설치 명령이 실패했습니다 (exit ${code}).`, 'install_failed');
      out.ok('업데이트 완료. 프로젝트의 스킬도 갱신하려면 rk skill install 을 실행하세요.');
      const project = c.project;
      if (project?.config.ai?.tools?.length && (await confirm(c, '이 프로젝트의 AI 스킬을 지금 갱신할까요?', true))) {
        await run('rk skill install');
      }
    });

  program
    .command('doctor')
    .description('환경 점검: node/pnpm, 자격 증명, 서버 연결, roomkit.json, 스킬, 업데이트')
    .action(async () => {
      const c = ctx();
      const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
      const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

      add('node', Number(process.versions.node.split('.')[0]) >= 22, `v${process.versions.node} (>=22 필요)`);
      const pnpm = await versionOf('pnpm');
      add('pnpm', pnpm !== null, pnpm ? `v${pnpm}` : '찾을 수 없음');

      const creds = loadCredentials();
      let mode = '';
      try {
        mode = (statSync(CREDENTIALS_PATH).mode & 0o777).toString(8);
      } catch {
        // no file
      }
      add('credentials', creds !== null || c.api.override !== null, creds ? `${CREDENTIALS_PATH} (mode ${mode}${process.platform !== 'win32' && mode !== '600' ? ', 600 권장' : ''})` : c.api.override ? '환경 변수/플래그' : '없음 — rk login');

      try {
        await c.api.ensureLogin();
        add('server', true, `${c.state.apiUrl} (${c.state.adminId})`);
      } catch (err) {
        add('server', false, err instanceof Error ? err.message : String(err));
      }

      let project = null;
      try {
        project = c.project;
        add('roomkit.json', project !== null, project ? project.path : '없음 (rk init / rk init ai / rk theme use)');
      } catch (err) {
        add('roomkit.json', false, err instanceof Error ? err.message : String(err));
      }
      if (project) {
        for (const w of project.config.websites) {
          const dir = resolve(project.root, w.dir);
          add(`website:${w.name}`, existsSync(dir), existsSync(dir) ? `${dir} → dist ${w.dist}` : `디렉터리 없음: ${dir}`);
        }
        const bundled = bundledSkillVersion();
        for (const s of skillStatus(project.root, project.config.ai?.tools ?? [])) {
          add(`skill:${s.tool}`, s.installed && s.version === bundled, s.installed ? `v${s.version}${s.version !== bundled ? ` (CLI v${bundled}, rk skill install)` : ''}` : '미설치');
        }
      }

      const update = await checkForUpdate({ force: true });
      add('update', update ? !update.outdated : true, update ? (update.outdated ? `v${update.latest} 사용 가능 (rk upgrade)` : `최신 (v${CLI_VERSION})`) : '확인 실패');

      emit(c, { version: CLI_VERSION, checks }, () => {
        out.line(kv(checks.map((ch) => [`${ch.ok ? pc.green('✔') : pc.red('✖')} ${ch.name}`, ch.detail])));
      });
      if (checks.some((ch) => !ch.ok)) process.exitCode = 1;
    });
}
