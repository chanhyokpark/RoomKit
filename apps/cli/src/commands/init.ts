import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import pc from 'picocolors';
import type { CliContext } from '../context.js';
import { createAsset, listAssets } from '../core/ops/assets.js';
import { createTheme } from '../core/ops/themes.js';
import { ToolError } from '../core/session.js';
import { emptyConfig, findProjectRoot, loadProject, saveProject, upsertWebsite, type AiTool, type RoomkitConfig } from '../project/config.js';
import { CREATE_NEW, pickTheme, resolveTheme } from '../project/theme.js';
import { installSkill } from '../skill/install.js';
import { SKILL_TARGETS } from '../skill/targets.js';
import { resolveTemplateId, TEMPLATES, type TemplateId } from '../templates/catalog.js';
import { downloadRepoArchive } from '../templates/download.js';
import { extractTemplate, isDirEmpty } from '../templates/extract.js';
import { parseDuration } from '../ui/json-input.js';
import { out, shortId } from '../ui/output.js';
import { confirm, intro, note, outro, select, spinner, text } from '../ui/prompt.js';
import { runLogin } from './auth.js';
import { parseTools, pickTools } from './skill.js';
import { emit, type GetContext } from './util.js';

interface InitFlags {
  dir?: string;
  template?: string;
  theme?: string;
  createTheme?: string;
  timeLimit?: string;
  asset?: string;
  createAsset?: string;
  assetKey?: string;
  noAsset?: boolean;
  name?: string;
  ref: string;
  install?: boolean;
  ai?: string;
  force?: boolean;
}

const NO_ASSET = '__none__';
const CREATE_ASSET = '__create__';

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'roomkit-site';
}

function runInstall(dir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['install'], { cwd: dir, stdio: 'inherit', shell: true });
    child.on('error', (err) => reject(new ToolError(`pnpm install 실행 실패: ${err.message}`, 'install_failed')));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new ToolError(`pnpm install 이 실패했습니다 (exit ${code}).`, 'install_failed'))));
  });
}

export async function runInit(ctx: CliContext, flags: InitFlags) {
  const interactive = ctx.interactive();
  if (interactive) intro(pc.bgCyan(pc.black(' RoomKit 웹사이트 프로젝트 만들기 ')));

  // 1. Location. An enclosing roomkit.json means "add a website to this project".
  const dirInput =
    flags.dir ??
    (await text(ctx, ['--dir'], { message: '프로젝트를 생성할 디렉터리', placeholder: '.', initialValue: '.' }));
  const targetDir = resolve(dirInput.trim() || '.');
  const enclosingRoot = findProjectRoot(existsSync(targetDir) ? targetDir : resolve(targetDir, '..'));
  const projectRoot = enclosingRoot ?? targetDir;
  let config: RoomkitConfig = enclosingRoot ? loadProject(enclosingRoot).config : emptyConfig();
  const websiteDir = relative(projectRoot, targetDir) || '.';
  if (websiteDir.startsWith('..')) throw new ToolError('생성 디렉터리는 roomkit.json 이 있는 프로젝트 안이어야 합니다.', 'usage');
  if (!isDirEmpty(targetDir) && !flags.force) {
    throw new ToolError(`${targetDir} 이 비어 있지 않습니다. 다른 위치를 지정하거나 --force 로 덮어쓰세요.`, 'usage');
  }
  if (enclosingRoot && interactive) note(`기존 프로젝트(${enclosingRoot})에 웹사이트를 추가합니다: ${websiteDir}`, '프로젝트');

  // 2. Login.
  try {
    await ctx.api.ensureLogin();
  } catch (err) {
    if (!interactive) throw err;
    note('먼저 RoomKit 서버에 로그인합니다.', '로그인');
    await runLogin(ctx, { save: true });
  }

  // 3. Theme.
  let theme: { id: string; name: string };
  if (flags.createTheme) {
    theme = await createTheme(ctx, { name: flags.createTheme, timeLimitMs: flags.timeLimit ? parseDuration(flags.timeLimit, '--time-limit') : null });
  } else if (flags.theme || ctx.flags.theme) {
    theme = await resolveTheme(ctx, flags.theme);
  } else if (config.theme && (!interactive || (await confirm(ctx, `프로젝트 테마 "${config.theme.name}" 을 그대로 사용할까요?`, true)))) {
    theme = config.theme;
  } else if (interactive) {
    const picked = await pickTheme(ctx, '웹사이트를 연결할 테마', true);
    if (picked.id === CREATE_NEW) {
      const name = await text(ctx, ['--create-theme'], { message: '새 테마 이름', validate: (v) => (v.trim() ? undefined : '이름을 입력해 주세요.') });
      const limit = await text(ctx, ['--time-limit'], { message: '제한시간 (예: 60m, 비우면 없음)', placeholder: '60m' });
      theme = await createTheme(ctx, { name, timeLimitMs: limit.trim() ? parseDuration(limit, '--time-limit') : null });
    } else theme = picked;
  } else {
    throw new ToolError('테마를 지정해 주세요: --theme <ref> 또는 --create-theme <name>', 'missing_input');
  }

  // 4. Website asset.
  let asset: { id: string; name: string; key: string | null } | null = null;
  if (flags.asset) {
    const a = (await listAssets(ctx, theme.id, { kind: 'website' })).find((w) => w.id === flags.asset || w.key === flags.asset || w.name === flags.asset);
    if (!a) throw new ToolError(`웹사이트 애셋 "${flags.asset}" 을 찾을 수 없습니다.`, 'not_found');
    asset = a;
  } else if (flags.createAsset) {
    asset = await createAsset(ctx, theme.id, { kind: 'website', name: flags.createAsset, ...(flags.assetKey && { key: flags.assetKey }), data: { mode: 'external', url: 'http://localhost:5173' } });
  } else if (flags.noAsset) {
    asset = null;
  } else if (interactive) {
    const websites = await listAssets(ctx, theme.id, { kind: 'website' });
    const choice = await select(ctx, ['--asset', '--create-asset', '--no-asset'], '이 웹사이트에 연결할 website 애셋', [
      ...websites.map((w) => ({ value: w.id, label: w.name, hint: w.key ?? shortId(w.id) })),
      { value: CREATE_ASSET, label: '+ 새 website 애셋 만들기' },
      { value: NO_ASSET, label: '나중에 (rk deploy --asset 으로 지정)' },
    ]);
    if (choice === CREATE_ASSET) {
      const defaultName = basename(targetDir);
      const name = await text(ctx, ['--create-asset'], { message: '애셋 이름', initialValue: defaultName });
      const key = await text(ctx, ['--asset-key'], { message: '애셋 키 (선택, 예: main-site)', initialValue: slug(name) });
      asset = await createAsset(ctx, theme.id, { kind: 'website', name, ...(key.trim() && { key: key.trim() }), data: { mode: 'external', url: 'http://localhost:5173' } });
    } else if (choice !== NO_ASSET) asset = websites.find((w) => w.id === choice)!;
  } else {
    throw new ToolError('웹사이트 애셋을 지정해 주세요: --asset <ref>, --create-asset <name>, 또는 --no-asset', 'missing_input');
  }

  // 5. Template.
  let templateId: TemplateId;
  if (flags.template) {
    const id = resolveTemplateId(flags.template);
    if (!id) throw new ToolError(`알 수 없는 템플릿 "${flags.template}". 사용 가능: react(web), svelte(web_svelte)`, 'usage');
    templateId = id;
  } else {
    templateId = await select(ctx, ['--template'], '템플릿', (Object.keys(TEMPLATES) as TemplateId[]).map((id) => ({ value: id, label: TEMPLATES[id].label, hint: TEMPLATES[id].hint })));
  }
  const template = TEMPLATES[templateId];

  // 6. Download + extract.
  const s = spinner(ctx, `템플릿 다운로드 중 (${flags.ref})`);
  let files: string[];
  try {
    const zip = await downloadRepoArchive(flags.ref);
    s.update('템플릿 추출 중');
    files = await extractTemplate(zip, template.dir, targetDir);
    s.stop(`템플릿 생성: ${files.length}개 파일 → ${targetDir}`);
  } catch (err) {
    s.fail('템플릿 생성 실패');
    throw err;
  }
  const pkgPath = join(targetDir, 'package.json');
  const projectName = slug(flags.name ?? basename(targetDir));
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
    pkg.name = projectName;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  // 7. Dependencies.
  const install = flags.install ?? (interactive ? await confirm(ctx, 'pnpm install 을 지금 실행할까요?', true) : false);
  if (install) await runInstall(targetDir);

  // 8. AI tools + skill.
  let tools: AiTool[] = [];
  if (flags.ai !== undefined) tools = parseTools(flags.ai) ?? [];
  else if (interactive) tools = await pickTools(ctx, config.ai?.tools ?? []);
  const mergedTools = [...new Set([...(config.ai?.tools ?? []), ...tools])];
  const skillReports = mergedTools.length ? installSkill(projectRoot, mergedTools) : [];

  // 9. roomkit.json.
  config = { ...config, server: ctx.state.apiUrl ?? config.server, theme: { id: theme.id, name: theme.name }, ...(mergedTools.length && { ai: { tools: mergedTools } }) };
  const websiteName = asset ? asset.key ?? slug(asset.name) : projectName;
  if (asset) {
    config = upsertWebsite(config, { name: websiteName, dir: websiteDir, assetId: asset.id, assetKey: asset.key, build: template.build, dist: template.dist });
  }
  const saved = saveProject(projectRoot, config);
  ctx.reloadProject();

  const result = {
    projectRoot,
    configPath: saved.path,
    websiteDir: targetDir,
    template: templateId,
    theme,
    asset,
    website: asset ? websiteName : null,
    installed: install,
    aiTools: mergedTools,
    skill: skillReports,
    files,
  };
  return { result, template };
}

export function register(program: Command, ctx: GetContext): void {
  program
    .command('init')
    .description('템플릿으로 웹사이트 프로젝트를 만들고 roomkit.json 을 생성/갱신합니다 (옵션 없이 실행하면 대화형)')
    .option('-d, --dir <path>', '생성 위치 (기본: 현재 디렉터리)')
    .option('--template <name>', '템플릿: react(web) | svelte(web_svelte)')
    .option('--create-theme <name>', '새 테마를 만들어 연결')
    .option('--time-limit <duration>', '--create-theme 의 제한시간 (예: 60m)')
    .option('--asset <ref>', '연결할 website 애셋 (uuid/키/이름)')
    .option('--create-asset <name>', '새 website 애셋을 만들어 연결')
    .option('--asset-key <key>', '--create-asset 의 키')
    .option('--no-asset', '애셋을 연결하지 않음')
    .option('--name <name>', 'package.json name (기본: 디렉터리 이름)')
    .option('--ref <ref>', '템플릿을 가져올 RoomKit 브랜치/태그/커밋', 'master')
    .option('--install', 'pnpm install 실행')
    .option('--no-install', 'pnpm install 생략')
    .option('--ai <list>', `스킬을 설치할 AI 도구 (쉼표 구분: ${Object.keys(SKILL_TARGETS).join(',')}; 빈 문자열 = 없음)`)
    .option('--force', '비어 있지 않은 디렉터리에도 생성')
    .action(async (raw: unknown) => {
      const opts = raw as Omit<InitFlags, 'asset'> & { asset?: string | boolean };
      const c = ctx();
      // commander maps --no-asset onto `asset: false`; keep the two apart.
      const flags: InitFlags = { ...opts, asset: typeof opts.asset === 'string' ? opts.asset : undefined, noAsset: opts.asset === false };
      const { result, template } = await runInit(c, flags);
      emit(c, result, () => {
        const rel = relative(process.cwd(), result.websiteDir) || '.';
        const steps = [
          rel !== '.' ? `cd ${rel}` : null,
          result.installed ? null : 'pnpm install',
          `${template.dev}   # 개발 서버 (Player 테스트 탭의 "웹사이트 URL 대체"에 주소 입력)`,
          result.asset ? `rk deploy ${result.website}   # 빌드 후 호스팅 배포` : 'rk deploy --dir . --asset <ref> --dist ' + template.dist + ' --save',
        ].filter(Boolean);
        if (c.interactive()) {
          note(steps.join('\n'), '다음 단계');
          outro(`완료! roomkit.json: ${result.configPath}`);
        } else {
          out.ok(`프로젝트 생성: ${result.websiteDir} (${template.label})`);
          out.line(`roomkit.json: ${result.configPath}`);
          for (const st of steps) out.line(`  ${st}`);
        }
        for (const r of result.skill) out.line(pc.dim(`스킬 설치: ${SKILL_TARGETS[r.tool].label} → ${r.paths.join(', ')}`));
      });
    });
}
