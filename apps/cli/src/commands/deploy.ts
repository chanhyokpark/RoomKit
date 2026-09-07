import type { Command } from 'commander';
import { relative, resolve } from 'node:path';
import pc from 'picocolors';
import type { CliContext } from '../context.js';
import { deployWebsite, type DeployResult } from '../core/ops/deploy.js';
import { getAsset } from '../core/ops/assets.js';
import { getTheme } from '../core/ops/themes.js';
import { ToolError } from '../core/session.js';
import { emptyConfig, saveProject, upsertWebsite, type WebsiteEntry } from '../project/config.js';
import { resolveThemeId } from '../project/theme.js';
import { out } from '../ui/output.js';
import { multiselect, spinner } from '../ui/prompt.js';
import { emit, type GetContext } from './util.js';

interface DeployFlags {
  all?: boolean;
  build: boolean;
  dir?: string;
  asset?: string;
  dist?: string;
  buildCommand?: string;
  save?: boolean;
  name?: string;
}

const STAGE_LABEL = { build: '빌드 중', zip: '압축 중', upload: '업로드 중', switch: '애셋 전환 중' } as const;

async function selectTargets(ctx: CliContext, names: string[], all: boolean | undefined): Promise<{ root: string; entries: WebsiteEntry[] }> {
  const project = ctx.project;
  if (!project) throw new ToolError('roomkit.json 이 없습니다. rk init 으로 프로젝트를 만들거나 --dir/--asset/--dist 로 직접 지정해 주세요.', 'no_project');
  const websites = project.config.websites;
  if (!websites.length) throw new ToolError('roomkit.json 에 websites 항목이 없습니다. rk init 또는 rk deploy --dir . --asset <ref> --dist dist --save 로 추가해 주세요.', 'usage');
  if (names.length) {
    const entries = names.map((n) => {
      const e = websites.find((w) => w.name === n);
      if (!e) throw new ToolError(`websites 에 "${n}" 항목이 없습니다. (있는 항목: ${websites.map((w) => w.name).join(', ')})`, 'usage');
      return e;
    });
    return { root: project.root, entries };
  }
  if (all || websites.length === 1) return { root: project.root, entries: websites };
  if (ctx.interactive()) {
    const chosen = await multiselect(ctx, ['--all', '<name>'], '배포할 웹사이트', websites.map((w) => ({ value: w.name, label: w.name, hint: `${w.dir} → ${w.assetKey ?? w.assetId}` })), websites.map((w) => w.name), true);
    return { root: project.root, entries: websites.filter((w) => chosen.includes(w.name)) };
  }
  throw new ToolError(`websites 항목이 여러 개입니다. 이름을 지정하거나 --all 을 사용해 주세요: ${websites.map((w) => w.name).join(', ')}`, 'missing_input');
}

export async function deployEntry(ctx: CliContext, themeId: string, root: string, entry: WebsiteEntry, build: boolean): Promise<DeployResult> {
  const dir = resolve(root, entry.dir);
  const s = spinner(ctx, `${entry.name}: 준비 중`);
  try {
    const result = await deployWebsite(ctx, {
      themeId,
      websiteRef: entry.assetId,
      buildDirectory: dir,
      buildCommand: build ? entry.build ?? null : null,
      buildDest: entry.dist,
      onStage: (stage) => s.update(`${entry.name}: ${STAGE_LABEL[stage]}`),
      onOutput: ctx.interactive() ? undefined : (chunk) => process.stderr.write(chunk),
    });
    s.stop(`${entry.name}: 배포 완료 (${result.fileCount}개 파일)`);
    return result;
  } catch (err) {
    s.fail(`${entry.name}: 실패`);
    throw err;
  }
}

export function register(program: Command, ctx: GetContext): void {
  program
    .command('deploy [names...]')
    .description('웹사이트를 빌드·압축·업로드하고 애셋을 호스팅 모드로 전환합니다 (roomkit.json 의 websites 기준)')
    .option('--all', 'websites 항목 전부')
    .option('--no-build', '빌드 생략 (기존 dist 사용)')
    .option('--dir <path>', '(직접 지정) 프로젝트 디렉터리')
    .option('--asset <ref>', '(직접 지정) 웹사이트 애셋 uuid/키/이름')
    .option('--dist <path>', '(직접 지정) 빌드 출력 디렉터리 (dir 기준)')
    .option('--build-command <cmd>', '(직접 지정) 빌드 명령 (기본: pnpm build)')
    .option('--save', '직접 지정한 설정을 roomkit.json 에 저장')
    .option('--name <name>', '--save 시 항목 이름 (기본: 애셋 키 또는 이름)')
    .action(async (names: string[], opts: DeployFlags) => {
      const c = ctx();
      const themeId = await resolveThemeId(c);
      const adHoc = opts.dir || opts.asset || opts.dist;
      let root: string;
      let entries: WebsiteEntry[];
      if (adHoc) {
        if (!opts.dir || !opts.asset || !opts.dist) throw new ToolError('--dir, --asset, --dist 를 모두 지정해 주세요.', 'usage');
        const asset = await getAsset(c, themeId, opts.asset, 'website');
        root = process.cwd();
        entries = [{ name: opts.name ?? asset.key ?? asset.name, dir: opts.dir, assetId: asset.id, assetKey: asset.key, build: opts.buildCommand ?? 'pnpm build', dist: opts.dist }];
        if (opts.save) {
          // Without a project, start one at cwd with the theme we are deploying to.
          const project = c.project ?? { root, config: { ...emptyConfig(), server: c.state.apiUrl ?? undefined, theme: await getTheme(c, themeId) } };
          const relDir = relative(project.root, resolve(root, opts.dir)) || '.';
          if (relDir.startsWith('..')) throw new ToolError(`--dir 은 프로젝트(${project.root}) 안이어야 합니다.`, 'usage');
          saveProject(project.root, upsertWebsite(project.config, { ...entries[0]!, dir: relDir }));
          c.reloadProject();
        }
      } else {
        ({ root, entries } = await selectTargets(c, names, opts.all));
      }

      const deployed: DeployResult[] = [];
      const failed: Array<{ name: string; error: string }> = [];
      for (const entry of entries) {
        try {
          deployed.push(await deployEntry(c, themeId, root, entry, opts.build));
        } catch (err) {
          failed.push({ name: entry.name, error: err instanceof Error ? err.message : String(err) });
          if (!c.json) out.fail(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      emit(c, { deployed, failed }, () => {
        for (const d of deployed) out.ok(`${pc.bold(d.name)} → ${d.url}`);
      });
      if (failed.length) process.exitCode = 1;
    });
}
