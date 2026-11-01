import type { Command } from 'commander';
import pc from 'picocolors';
import { DeviceLogLevelSchema, type DeviceLogLevel, type DeviceLogLine, type SessionDeviceStatus } from '@roomkit/shared';
import {
  getDeviceLogs,
  listSessionDevices,
  reloadDevice,
  resolveSessionDevice,
  waitForDevicesReady,
  windowDevice,
} from '../core/ops/devices.js';
import { getSession } from '../core/ops/sessions.js';
import { ToolError } from '../core/session.js';
import { parseInteger } from '../ui/json-input.js';
import { out, table } from '../ui/output.js';
import { finishWithScreenshot, focusBeforehand, prepareScreenshotPath } from './device-eval.js';
import { emit, fmtDate, type GetContext } from './util.js';

const LOG_LEVELS = DeviceLogLevelSchema.options;
/** Website console lines forwarded by Helper 0.10.0+ carry this prefix; player lines have none. */
const SITE_PREFIX = 'site: ';

/** `--level`: a minimum level, validated before any request. */
export function parseLogLevel(value: string): DeviceLogLevel {
  const parsed = DeviceLogLevelSchema.safeParse(value);
  if (!parsed.success) throw new ToolError(`--level: ${LOG_LEVELS.join(', ')} 중 하나여야 합니다 ("${value}").`, 'usage');
  return parsed.data;
}

/** Lines with `seq > afterSeq` at or above `minLevel`; `tail` keeps the last n of those. */
export function filterDeviceLogLines(
  lines: DeviceLogLine[],
  opts: { afterSeq?: number; minLevel?: DeviceLogLevel; tail?: number },
): DeviceLogLine[] {
  const min = opts.minLevel ? LOG_LEVELS.indexOf(opts.minLevel) : 0;
  const kept = lines.filter(
    (l) => (opts.afterSeq === undefined || l.seq > opts.afterSeq) && LOG_LEVELS.indexOf(l.level) >= min,
  );
  return opts.tail === undefined ? kept : kept.slice(Math.max(0, kept.length - opts.tail));
}

/** One human-readable device log line: seq, device-clock time, level, message. */
export function formatDeviceLogLine(l: DeviceLogLine): string {
  const label = l.level.padEnd(5);
  const level =
    l.level === 'error' ? pc.red(label) : l.level === 'warn' ? pc.yellow(label) : l.level === 'debug' ? pc.dim(label) : label;
  const message = l.message.startsWith(SITE_PREFIX)
    ? `${pc.cyan(SITE_PREFIX.trimEnd())} ${l.message.slice(SITE_PREFIX.length)}`
    : l.message;
  return `${pc.dim(String(l.seq).padStart(6))} ${pc.dim(fmtDate(new Date(l.at)))} ${level} ${message}`;
}

function nonNegative(value: string, flag: string): number {
  const n = parseInteger(value, flag);
  if (n < 0) throw new ToolError(`${flag}: 0 이상이어야 합니다 ("${value}").`, 'usage');
  return n;
}

function describeStatus(d: SessionDeviceStatus): string {
  if (!d.online) return pc.red('오프라인');
  if (d.windows > 1) return pc.yellow(`창 ${d.windows}개`);
  if (d.website && d.helperVersion === undefined) return pc.yellow('Helper 대기');
  return d.ready ? pc.green('준비됨') : pc.yellow('미준비');
}

/**
 * Per-device debug tools for any live session, production included: Player
 * window focus/screenshot, forced website reload, status and device logs.
 */
export function registerDeviceTools(device: Command, ctx: GetContext): void {
  device
    .command('focus <device>')
    .description('Player 창을 앞으로 가져옴 (표시·최소화 해제·포커스·렌더링 대기; 운영 세션 포함)')
    .requiredOption('--session <id>', '종료되지 않은 세션 UUID (테스트·운영)')
    .option('--timeout <ms>', '창이 보일 때까지 기다리는 시간 (100–60000ms)', '10000')
    .action(async (deviceRef: string, opts: { session: string; timeout: string }) => {
      const c = ctx();
      const response = await windowDevice(c, opts.session, deviceRef, {
        focus: true,
        timeoutMs: parseInteger(opts.timeout, '--timeout'),
      });
      const result = finishWithScreenshot(response, undefined);
      emit(c, result, () => {
        const v = result.value;
        out.ok(`창 포커스: ${v.visible ? '표시됨' : pc.yellow('아직 가려짐')}${v.focused ? ', 포커스됨' : ''} (${v.platform})`);
      });
    });

  device
    .command('screenshot <device> <path>')
    .description('Player 창을 새로 캡처해 PNG/JPEG 로 저장 (웹사이트가 없어도 동작; 운영 세션 포함)')
    .requiredOption('--session <id>', '종료되지 않은 세션 UUID (테스트·운영)')
    .option('--focus', '캡처 전에 창을 앞으로 가져옴', false)
    .option('--overwrite', '대상 파일이 있으면 덮어씀', false)
    .option('--timeout <ms>', '포커스·캡처 제한 시간 (100–60000ms)', '10000')
    .action(
      async (
        deviceRef: string,
        pathArg: string,
        opts: { session: string; focus: boolean; overwrite: boolean; timeout: string },
      ) => {
        const target = prepareScreenshotPath(pathArg, opts.overwrite);
        const c = ctx();
        const response = await windowDevice(c, opts.session, deviceRef, {
          focus: opts.focus,
          screenshot: true,
          screenshotFormat: target.format,
          timeoutMs: parseInteger(opts.timeout, '--timeout'),
        });
        const result = finishWithScreenshot(response, { path: target.path, overwrite: opts.overwrite });
        emit(c, result, () => {
          out.ok(`스크린샷: ${result.screenshot?.path}`);
          if (!result.value.visible) out.warn('창이 가려진 상태였습니다. --focus 를 함께 사용하세요.');
        });
      },
    );

  device
    .command('reload <device>')
    .description('Player 가 보여주는 웹사이트를 강제 새로고침 (iframe 재생성; 운영 세션 포함)')
    .requiredOption('--session <id>', '종료되지 않은 세션 UUID (테스트·운영)')
    .option('--wait-ready', '새 페이지의 Helper hello 까지 기다림 (eval 가능 상태)', false)
    .option('--focus', '새로고침 전에 창을 앞으로 가져옴', false)
    .option('--timeout <ms>', '로드(및 Helper) 대기 시간 (100–120000ms)', '15000')
    .action(
      async (
        deviceRef: string,
        opts: { session: string; waitReady: boolean; focus: boolean; timeout: string },
      ) => {
        const c = ctx();
        const timeoutMs = parseInteger(opts.timeout, '--timeout');
        if (opts.focus) await focusBeforehand(c, opts.session, deviceRef, Math.min(timeoutMs, 60_000));
        const result = await reloadDevice(c, opts.session, deviceRef, { waitReady: opts.waitReady, timeoutMs });
        if (!result.loaded)
          throw new ToolError(
            `Website did not finish loading (${result.status}). Check the Player window and the dev server; do not assume the page state.`,
            'reload_failed',
            result,
          );
        if (opts.waitReady && !result.helperReady)
          throw new ToolError(
            'Website loaded but its Helper did not say hello before the deadline (no Helper bundled, old Helper, or a slow page).',
            'helper_not_ready',
            result,
          );
        emit(c, result, () => {
          out.ok(`새로고침 완료: ${result.url}`);
          if (opts.waitReady) out.line(pc.dim(`Helper ${result.helperVersion ?? '(버전 없음)'} 준비됨`));
        });
      },
    );

  device
    .command('status')
    .description('세션 장치의 연결·Helper·웹사이트 상태 (eval 가능 여부 진단; 모든 세션)')
    .requiredOption('--session <id>', '세션 UUID (테스트·운영)')
    .option('--device <ref>', '이 장치만 (키·코드·이름·UUID)')
    .option('--wait-ready', '모든(또는 --device) 장치가 eval 가능해질 때까지 기다림', false)
    .option('--timeout <ms>', '--wait-ready 대기 시간', '30000')
    .action(async (opts: { session: string; device?: string; waitReady: boolean; timeout: string }) => {
      const c = ctx();
      let deviceId: string | undefined;
      if (opts.device) {
        const resolved = await resolveSessionDevice(c, opts.session, opts.device, 'Device status filtering');
        deviceId = resolved.deviceId;
      }
      const { ready, status } = opts.waitReady
        ? await waitForDevicesReady(c, opts.session, { deviceId, timeoutMs: parseInteger(opts.timeout, '--timeout') })
        : { ready: undefined, status: await listSessionDevices(c, opts.session) };
      const devices = deviceId ? status.devices.filter((d) => d.deviceId === deviceId) : status.devices;
      const result = { ...status, devices, ...(ready === undefined ? {} : { ready }) };
      if (ready === false)
        throw new ToolError(
          status.state === 'ended'
            ? 'Session ended while waiting.'
            : 'Devices did not become ready before the deadline (offline, duplicate windows, or no Helper hello).',
          'not_ready',
          result,
        );
      emit(c, result, () => {
        out.line(
          table(
            ['장치', '상태', '창', 'Helper', '웹사이트', '상태값', '캡처'],
            devices.map((d) => [
              d.displayName,
              describeStatus(d),
              String(d.windows),
              d.helperVersion === undefined ? '' : (d.helperVersion ?? '(버전 없음)'),
              d.website?.url ?? '',
              d.state?.stateName ?? '',
              d.screenshotAt ? fmtDate(new Date(d.screenshotAt)) : '',
            ]),
          ),
        );
      });
    });

  device
    .command('logs <device>')
    .description('장치 로그 조회 (Player 콘솔 + Helper 0.10.0+ 웹사이트 콘솔 "site:"; 장치당 최근 1000줄, 세션 종료 시 삭제)')
    .requiredOption('--session <id>', '종료되지 않은 세션 UUID (테스트·운영)')
    .option('--after <seq>', '이 seq 이후 줄만')
    .option('--tail <n>', '마지막 n줄만 (--after·--level 적용 후)')
    .option('--level <level>', `최소 레벨 (${LOG_LEVELS.join('|')})`)
    .option('-f, --follow', '새 로그를 계속 출력 (Ctrl-C 로 종료, 세션이 끝나면 멈춤; --json 은 NDJSON)')
    .option('--interval <ms>', '--follow 폴링 간격', '1000')
    .action(
      async (
        deviceRef: string,
        opts: { session: string; after?: string; tail?: string; level?: string; follow?: boolean; interval: string },
      ) => {
        const afterSeq = opts.after === undefined ? undefined : nonNegative(opts.after, '--after');
        const tail = opts.tail === undefined ? undefined : nonNegative(opts.tail, '--tail');
        const minLevel = opts.level === undefined ? undefined : parseLogLevel(opts.level);
        const interval = parseInteger(opts.interval, '--interval');
        if (interval < 100) throw new ToolError('--interval: 100ms 이상이어야 합니다.', 'usage');
        const c = ctx();
        const { session, deviceId } = await resolveSessionDevice(c, opts.session, deviceRef, 'Reading device logs');
        const batch = await getDeviceLogs(c, session.id, deviceId);
        const first = filterDeviceLogLines(batch.lines, { afterSeq, minLevel, tail });
        if (!opts.follow) {
          if (c.json) return emit(c, { ...batch, lines: first }, () => {});
          if (!first.length) return out.info('로그가 없습니다.');
          for (const l of first) out.line(formatDeviceLogLine(l));
          return;
        }
        const print = (lines: DeviceLogLine[]) => {
          for (const l of lines) out.line(c.json ? JSON.stringify(l) : formatDeviceLogLine(l));
        };
        // Track the newest seq seen across all levels so a level filter never re-prints.
        const newest = (lines: DeviceLogLine[], fallback: number) => (lines.length ? lines[lines.length - 1]!.seq : fallback);
        print(first);
        let lastSeq = Math.max(afterSeq ?? -1, newest(batch.lines, -1));
        if (!c.json) out.line(pc.dim('새 로그를 기다립니다. Ctrl-C 로 종료합니다.'));
        for (;;) {
          await new Promise((r) => setTimeout(r, interval));
          const current = await getSession(c, session.id);
          if (current.state === 'ended') {
            if (!c.json) out.info('세션이 종료되어 로그 출력을 멈춥니다.');
            return;
          }
          const next = await getDeviceLogs(c, session.id, deviceId);
          // A buffer whose newest seq went backwards was recreated (server restart): start over.
          if (next.lines.length && newest(next.lines, -1) < lastSeq) lastSeq = -1;
          print(filterDeviceLogLines(next.lines, { afterSeq: lastSeq, minLevel }));
          lastSeq = newest(next.lines, lastSeq);
        }
      },
    );
}
