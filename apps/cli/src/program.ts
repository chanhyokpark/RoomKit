import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { CliContext, type GlobalFlags } from './context.js';
import { ToolError } from './core/session.js';
import { checkForUpdate, type UpdateInfo } from './update/check.js';
import { CLI_VERSION } from './version.js';
import type { CommandModule } from './commands/util.js';
import * as auth from './commands/auth.js';
import * as theme from './commands/theme.js';
import * as tag from './commands/tag.js';
import * as asset from './commands/asset.js';
import * as files from './commands/files.js';
import * as deploy from './commands/deploy.js';
import * as dev from './commands/dev.js';
import * as sequence from './commands/sequence.js';
import * as session from './commands/session.js';
import * as device from './commands/device.js';
import * as importCmd from './commands/import.js';
import * as docs from './commands/docs.js';
import * as describe from './commands/describe.js';
import * as init from './commands/init.js';
import * as skill from './commands/skill.js';
import * as maintenance from './commands/maintenance.js';

const MODULES: CommandModule[] = [auth, theme, tag, asset, files, deploy, dev, sequence, session, device, importCmd, docs, describe, init, skill, maintenance];

/** Commands that must not trigger the background update check. */
const NO_UPDATE_CHECK = new Set(['version', 'upgrade', 'help']);

export interface ProgramHandle {
  program: Command;
  /** Resolves to the update info once the background check settles (null when skipped/failed). */
  update(): Promise<UpdateInfo | null>;
  ctx(): CliContext;
}

export function createProgram(): ProgramHandle {
  let ctx: CliContext | null = null;
  let update: Promise<UpdateInfo | null> = Promise.resolve(null);

  const program = new Command('rk')
    .description('RoomKit CLI — 프로젝트 초기화, 배포, 테마 제작과 테스트를 터미널에서')
    .version(CLI_VERSION, '-V, --version', '버전 출력')
    .helpOption('-h, --help', '도움말 출력')
    .helpCommand('help [command]', '명령 도움말 출력')
    .option('--json', 'JSON으로 출력 (프롬프트 없음)', false)
    .option('-y, --yes', '확인 없이 진행하고 프롬프트를 사용하지 않음', false)
    .option('--no-input', '--yes 와 동일')
    .option('-t, --theme <ref>', '이번 명령에서 사용할 테마 (uuid 또는 이름)')
    .option('-p, --project <path>', 'roomkit.json 위치 (기본: 현재 디렉터리에서 상위로 탐색)')
    .option('--url <url>', '서버 주소 (이번 실행에만 사용, --id/--password 와 함께)')
    .option('--id <id>', '관리자 ID')
    .option('--password <password>', '관리자 비밀번호')
    .option('--no-update-check', '새 버전 확인 생략')
    .showHelpAfterError('(도움말: rk <명령> --help)')
    .showSuggestionAfterError(true)
    .configureOutput({ writeErr: (str) => process.stderr.write(str) })
    .exitOverride();

  program.hook('preAction', (_this, action) => {
    const opts = program.opts<{
      json: boolean;
      yes: boolean;
      input: boolean;
      theme?: string;
      project?: string;
      url?: string;
      id?: string;
      password?: string;
      updateCheck: boolean;
    }>();
    const flags: GlobalFlags = {
      json: opts.json,
      yes: opts.yes || opts.input === false,
      theme: opts.theme,
      project: opts.project,
      url: opts.url,
      id: opts.id,
      password: opts.password,
      updateCheck: opts.updateCheck && !process.env.ROOMKIT_NO_UPDATE_CHECK,
    };
    ctx = new CliContext(flags);
    const root = rootCommandName(action);
    if (flags.updateCheck && !NO_UPDATE_CHECK.has(root)) {
      update = checkForUpdate().catch(() => null);
    }
  });

  const getCtx = () => {
    if (!ctx) throw new ToolError('internal: context not initialised', 'internal');
    return ctx;
  };
  for (const mod of MODULES) mod.register(program, getCtx);

  return { program, update: () => update, ctx: getCtx };
}

function rootCommandName(command: Command): string {
  let c = command;
  while (c.parent && c.parent.parent) c = c.parent;
  return c.name();
}

export { CommanderError, InvalidArgumentError };
