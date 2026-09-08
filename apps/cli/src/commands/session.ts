import type { Command } from 'commander';
import pc from 'picocolors';
import type { Session, SessionLogEntry, SessionResponse } from '@roomkit/shared';
import type { CliContext } from '../context.js';
import {
  abortSessionRun,
  controlSession,
  createSession,
  deleteSession,
  getSession,
  getSessionLogs,
  getSessionSummary,
  listSessionRuns,
  listSessions,
  runSessionCommand,
  type ControlAction,
} from '../core/ops/sessions.js';
import { ToolError } from '../core/session.js';
import { resolveThemeId } from '../project/theme.js';
import { collect, parseDuration, parseInteger, parsePairs, readJsonArg } from '../ui/json-input.js';
import { kv, out, table } from '../ui/output.js';
import { confirm } from '../ui/prompt.js';
import { emit, fmtDate, type GetContext } from './util.js';

function printSession(s: SessionResponse | Session): void {
  out.line(
    kv([
      ['ID', s.id],
      ['모드', s.mode],
      ['상태', s.state],
      ['페이즈', s.phaseId],
      ['판정', s.verdict],
      ['시작', fmtDate(s.startedAt)],
      ['종료', s.endedAt ? fmtDate(s.endedAt) : undefined],
      ['타이머 종료', s.timerEndsAt ? fmtDate(s.timerEndsAt) : undefined],
      ['남은 시간(ms)', s.timerRemainingMs ?? undefined],
    ]),
  );
  if ('testDeviceCodes' in s && s.testDeviceCodes?.length) {
    out.line();
    out.line(pc.bold('테스트 장치 코드'));
    out.line(table(['장치', '코드'], s.testDeviceCodes.map((d) => [d.deviceName ?? d.deviceId, d.code])));
  }
}

/** One human-readable line per session log entry (shared with `rk dev`). */
export function formatLogLine(l: SessionLogEntry): string {
  const level = l.level === 'error' ? pc.red(l.level) : l.level === 'warn' ? pc.yellow(l.level) : pc.dim(l.level);
  const data = l.data !== null && l.data !== undefined ? ` ${pc.dim(JSON.stringify(l.data))}` : '';
  return `${pc.dim(String(l.id).padStart(6))} ${pc.dim(fmtDate(l.at))} ${level} ${pc.cyan(l.kind)} ${l.message}${data}`;
}

async function control(c: CliContext, sessionId: string, action: ControlAction, label: string): Promise<void> {
  const result = await controlSession(c, sessionId, action);
  emit(c, result ?? { ok: true }, () => {
    out.ok(`${label}: ${sessionId}`);
    if (result && typeof result === 'object' && 'state' in result) out.line(pc.dim(`상태: ${(result as Session).state}`));
  });
}

export function register(program: Command, ctx: GetContext): void {
  const session = program.command('session').description('세션 생성·제어·조회');

  session
    .command('create')
    .description('세션 만들기 (start 전까지 대기). 테스트 모드 기본: 장치별 코드 자동 생성')
    .option('--mode <mode>', 'test | production', 'test')
    .option('--device-code <ref=code>', '장치별 테스트 코드 지정 (반복 가능)', collect)
    .option('--player <id>', '연결된 Player 런처 id (실제 장치 창을 엶)')
    .option('--devices <refs>', '--player 와 함께: 이 장치들만 (쉼표 구분)')
    .option('--url-override <ref=url>', '웹사이트 애셋 URL 대체 (반복 가능, 예: main=http://localhost:5173)', collect)
    .option('--start', '생성 직후 시작')
    .action(async (opts: { mode: string; deviceCode?: string[]; player?: string; devices?: string; urlOverride?: string[]; start?: boolean }) => {
      const c = ctx();
      if (opts.mode !== 'test' && opts.mode !== 'production') throw new ToolError('--mode 는 test 또는 production 이어야 합니다.', 'usage');
      const themeId = await resolveThemeId(c);
      const deviceCodes = parsePairs(opts.deviceCode, '--device-code').map(([deviceId, code]) => ({ deviceId, code }));
      const urlOverrides = parsePairs(opts.urlOverride, '--url-override').map(([websiteId, url]) => ({ websiteId, url }));
      const result = await createSession(c, {
        themeId,
        mode: opts.mode,
        deviceCodes: deviceCodes.length ? deviceCodes : undefined,
        playerId: opts.player,
        deviceIds: opts.devices?.split(',').map((s) => s.trim()).filter(Boolean),
        urlOverrides: urlOverrides.length ? urlOverrides : undefined,
      });
      let started: unknown;
      if (opts.start) started = await controlSession(c, result.session.id, { type: 'start' });
      emit(c, { ...result, ...(started ? { started: true } : {}) }, () => {
        out.ok(`세션 생성: ${pc.bold(result.session.id)} (${result.session.mode})${started ? ' — 시작됨' : ''}`);
        if (result.generatedDeviceCodes) {
          out.line(table(['장치', '코드'], result.generatedDeviceCodes.map((d) => [d.deviceName, d.code])));
          out.line(pc.dim(`가상 장치 연결: rk device connect --session ${result.session.id}`));
        }
        if (!started) out.line(pc.dim(`시작: rk session start ${result.session.id}`));
      });
    });

  const simple: Array<[string, ControlAction['type'], string]> = [
    ['start', 'start', '세션 시작 (session:start 이벤트, 타이머 가동)'],
    ['pause', 'pause', '일시정지'],
    ['resume', 'resume', '재개'],
    ['end', 'end', '종료'],
    ['restart-phase', 'restart_phase', '현재 페이즈 재시작'],
    ['reset-devices', 'reset_devices', '모든 장치 초기화'],
  ];
  for (const [name, type, desc] of simple) {
    session
      .command(`${name} <sessionId>`)
      .description(desc)
      .action(async (sessionId: string) => control(ctx(), sessionId, { type } as ControlAction, desc));
  }

  session
    .command('timer <sessionId>')
    .description('타이머 조정')
    .option('--delta <duration>', '남은 시간 가감 (예: 5m, -30s, 60000)')
    .option('--pause', '타이머 일시정지')
    .option('--resume', '타이머 재개')
    .action(async (sessionId: string, opts: { delta?: string; pause?: boolean; resume?: boolean }) => {
      const adjustment = opts.delta !== undefined ? { deltaMs: parseDuration(opts.delta, '--delta') } : opts.pause ? { action: 'pause' as const } : opts.resume ? { action: 'resume' as const } : null;
      if (!adjustment) throw new ToolError('--delta, --pause, --resume 중 하나를 지정해 주세요.', 'usage');
      await control(ctx(), sessionId, { type: 'adjust_timer', adjustment } as ControlAction, '타이머 조정');
    });

  session
    .command('phase <sessionId> <phaseRef>')
    .description('페이즈 전환 (uuid/키/이름)')
    .action(async (sessionId: string, phaseId: string) => control(ctx(), sessionId, { type: 'switch_phase', phaseId }, '페이즈 전환'));

  session
    .command('trigger <sessionId> <eventRef>')
    .description('수동 실행 가능한 이벤트 실행')
    .action(async (sessionId: string, eventId: string) => control(ctx(), sessionId, { type: 'trigger_event', eventId }, '이벤트 실행'));

  session
    .command('hint <sessionId> <hintRef>')
    .description('힌트 푸시')
    .option('--step <n>', '단계 (0부터)', '0')
    .action(async (sessionId: string, hintId: string, opts: { step: string }) =>
      control(ctx(), sessionId, { type: 'push_hint', hintId, step: parseInteger(opts.step, '--step') }, '힌트 푸시'));

  session
    .command('command <sessionId>')
    .alias('cmd')
    .description('시퀀스 커맨드 하나를 세션에 즉시 실행 (운영 콘솔). 결과는 logs 로 확인')
    .requiredOption('--command <json>', '커맨드 JSON (id 없이), @파일, - (stdin)')
    .action(async (sessionId: string, opts: { command: string }) => {
      const c = ctx();
      const result = await runSessionCommand(c, sessionId, readJsonArg<Record<string, unknown>>(opts.command, '--command'));
      emit(c, result, () => out.ok(`전송: ${result.dispatched} ${pc.dim('(rk session logs 로 결과 확인)')}`));
    });

  session
    .command('runs <sessionId>')
    .description('진행 중인 이벤트 실행 목록')
    .action(async (sessionId: string) => {
      const c = ctx();
      const runs = await listSessionRuns(c, sessionId);
      emit(c, runs, () => {
        if (!runs.runs.length) return out.info('진행 중인 실행이 없습니다.');
        out.line(JSON.stringify(runs.runs, null, 2));
      });
    });

  session
    .command('abort <sessionId> <runId>')
    .description('이벤트 실행 강제 종료')
    .action(async (sessionId: string, runId: string) => {
      const c = ctx();
      const result = await abortSessionRun(c, sessionId, runId);
      emit(c, result, () => out.ok(`중단: ${runId}`));
    });

  session
    .command('list')
    .description('세션 목록 (기본: 프로젝트 테마)')
    .option('--active', '종료되지 않은 세션만')
    .option('--all-themes', '모든 테마')
    .action(async (opts: { active?: boolean; allThemes?: boolean }) => {
      const c = ctx();
      const themeId = opts.allThemes ? undefined : await resolveThemeId(c);
      const sessions = await listSessions(c, { themeId, activeOnly: opts.active });
      emit(c, sessions, () => {
        if (!sessions.length) return out.info('세션이 없습니다.');
        out.line(table(['ID', '모드', '상태', '시작', '종료'], sessions.map((s) => [s.id, s.mode, s.state, fmtDate(s.startedAt), s.endedAt ? fmtDate(s.endedAt) : ''])));
      });
    });

  session
    .command('get <sessionId>')
    .description('세션 상태')
    .action(async (sessionId: string) => {
      const c = ctx();
      const s = await getSession(c, sessionId);
      emit(c, s, () => printSession(s));
    });

  session
    .command('summary <sessionId>')
    .description('종료된 세션의 요약 통계')
    .action(async (sessionId: string) => {
      const c = ctx();
      const s = await getSessionSummary(c, sessionId);
      emit(c, s, () => out.line(JSON.stringify(s, null, 2)));
    });

  session
    .command('logs <sessionId>')
    .description('세션 로그 (id 오름차순)')
    .option('--after <id>', '이 id 이후만')
    .option('--limit <n>', '최대 개수 (≤500)')
    .option('-f, --follow', '새 로그를 계속 출력 (Ctrl-C 로 종료; --json 은 NDJSON)')
    .option('--interval <ms>', '--follow 폴링 간격', '1000')
    .action(async (sessionId: string, opts: { after?: string; limit?: string; follow?: boolean; interval: string }) => {
      const c = ctx();
      let afterId = opts.after !== undefined ? parseInteger(opts.after, '--after') : undefined;
      const limit = opts.limit !== undefined ? parseInteger(opts.limit, '--limit') : undefined;
      const printEntries = (logs: SessionLogEntry[]) => {
        for (const l of logs) out.line(c.json ? JSON.stringify(l) : formatLogLine(l));
      };
      if (!opts.follow) {
        const result = await getSessionLogs(c, sessionId, { afterId, limit });
        if (c.json) return emit(c, result, () => {});
        if (!result.logs.length) return out.info('로그가 없습니다.');
        printEntries(result.logs);
        return;
      }
      const interval = parseInteger(opts.interval, '--interval');
      for (;;) {
        const result = await getSessionLogs(c, sessionId, { afterId, limit: 500 });
        printEntries(result.logs);
        afterId = result.nextAfterId;
        await new Promise((r) => setTimeout(r, interval));
      }
    });

  session
    .command('delete <sessionId>')
    .description('세션과 로그 영구 삭제')
    .action(async (sessionId: string) => {
      const c = ctx();
      const ok = await confirm(c, `세션 ${sessionId} 을 삭제할까요?`);
      if (!ok) throw new ToolError('cancelled', 'cancelled');
      const result = await deleteSession(c, sessionId);
      emit(c, result, () => out.ok(`세션 삭제: ${sessionId}`));
    });
}
