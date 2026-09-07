import type { Command } from 'commander';
import pc from 'picocolors';
import type { CliContext } from '../context.js';
import { ToolError } from '../core/session.js';
import { AI_TOOL_IDS, AiToolSchema, saveProject, type AiTool } from '../project/config.js';
import { bundledSkillVersion, installSkill, removeSkill, skillStatus } from '../skill/install.js';
import { SKILL_TARGETS } from '../skill/targets.js';
import { out, table } from '../ui/output.js';
import { multiselect } from '../ui/prompt.js';
import { emit, type GetContext } from './util.js';

export function parseTools(value: string | undefined): AiTool[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const parsed = AiToolSchema.safeParse(s);
      if (!parsed.success) throw new ToolError(`알 수 없는 AI 도구 "${s}". 사용 가능: ${AI_TOOL_IDS.join(', ')}`, 'usage');
      return parsed.data;
    });
}

export const TOOL_CHOICES = AI_TOOL_IDS.map((id) => ({ value: id, label: SKILL_TARGETS[id].label, hint: SKILL_TARGETS[id].hint }));

export async function pickTools(ctx: CliContext, initial: AiTool[]): Promise<AiTool[]> {
  return multiselect(ctx, ['--tools', '--no-ai'], '스킬을 설치할 AI 도구 (스페이스로 선택)', TOOL_CHOICES, initial.length ? initial : ['claude']);
}

function requireProject(ctx: CliContext) {
  const project = ctx.project;
  if (!project) throw new ToolError('roomkit.json 이 없습니다. rk init 또는 rk theme use 로 프로젝트를 만들어 주세요.', 'no_project');
  return project;
}

export function register(program: Command, ctx: GetContext): void {
  const skill = program.command('skill').description('AI 에이전트용 roomkit 스킬을 프로젝트에 설치/갱신 (프로젝트 범위)');

  skill
    .command('install')
    .description('스킬 설치 또는 갱신 (도구 미지정 시 roomkit.json 의 ai.tools, 없으면 선택)')
    .option('--tools <list>', `쉼표 구분: ${AI_TOOL_IDS.join(',')}`)
    .action(async (opts: { tools?: string }) => {
      const c = ctx();
      const project = requireProject(c);
      let tools = parseTools(opts.tools) ?? project.config.ai?.tools ?? [];
      if (!tools.length) tools = await pickTools(c, []);
      if (!tools.length) throw new ToolError('설치할 도구가 없습니다.', 'missing_input');
      const reports = installSkill(project.root, tools);
      const merged = [...new Set([...(project.config.ai?.tools ?? []), ...tools])];
      saveProject(project.root, { ...project.config, ai: { tools: merged } });
      c.reloadProject();
      emit(c, { root: project.root, installed: reports }, () => {
        for (const r of reports) out.ok(`${SKILL_TARGETS[r.tool].label}: ${r.paths.join(', ')} ${pc.dim(`(v${r.version})`)}`);
        out.line(pc.dim('스킬 파일은 rk 가 관리합니다. 직접 수정하지 마세요 (rk skill install 로 갱신).'));
      });
    });

  skill
    .command('status')
    .description('설치된 스킬과 버전')
    .action(async () => {
      const c = ctx();
      const project = requireProject(c);
      const tools = project.config.ai?.tools ?? [];
      const status = skillStatus(project.root, tools.length ? tools : [...AI_TOOL_IDS]);
      const bundled = bundledSkillVersion();
      emit(c, { bundledVersion: bundled, tools: status }, () => {
        out.line(table(['도구', '설치', '버전', '경로'], status.map((s) => [SKILL_TARGETS[s.tool].label, s.installed ? '예' : '아니오', s.version ?? '-', s.paths.join(', ')])));
        const stale = status.filter((s) => s.installed && bundled && s.version !== bundled);
        if (stale.length) out.warn(`CLI 스킬 버전(v${bundled})과 다른 설치가 있습니다: rk skill install 로 갱신하세요.`);
      });
    });

  skill
    .command('remove')
    .description('스킬 제거')
    .option('--tools <list>', '쉼표 구분 (기본: roomkit.json 의 모든 도구)')
    .action(async (opts: { tools?: string }) => {
      const c = ctx();
      const project = requireProject(c);
      const current = project.config.ai?.tools ?? [];
      const tools = parseTools(opts.tools) ?? current;
      const remaining = current.filter((t) => !tools.includes(t));
      const touched = removeSkill(project.root, tools, remaining);
      saveProject(project.root, { ...project.config, ai: { tools: remaining } });
      c.reloadProject();
      emit(c, { removed: tools, touched }, () => out.ok(`제거: ${tools.join(', ') || '(없음)'} ${pc.dim(touched.join(', '))}`));
    });

  skill
    .command('list')
    .description('지원하는 AI 도구')
    .action(async () => {
      const c = ctx();
      emit(c, TOOL_CHOICES, () => out.line(table(['id', '도구', '설치 위치'], TOOL_CHOICES.map((t) => [t.value, t.label, t.hint]))));
    });
}
