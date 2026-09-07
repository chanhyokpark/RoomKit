import type { Command } from 'commander';
import pc from 'picocolors';
import { connectDevices, resolveDeviceCodes, triggerFromDevice } from '../core/ops/devices.js';
import { getSession } from '../core/ops/sessions.js';
import { ToolError } from '../core/session.js';
import { collect, parseDuration, parseInteger, readJsonArg } from '../ui/json-input.js';
import { out, table } from '../ui/output.js';
import { emit, fmtDate, type GetContext } from './util.js';

export function register(program: Command, ctx: GetContext): void {
  const device = program.command('device').description('가상 장치 (헤드리스 socket.io 장치) — 재생 없이 즉시 ack');

  device
    .command('connect')
    .description('가상 장치를 연결하고 받은 커맨드를 계속 출력합니다 (Ctrl-C 또는 --for 로 종료; --json 은 NDJSON)')
    .option('--session <id>', '이 테스트 세션의 모든 장치 코드 연결')
    .option('--code <code>', '장치 코드 (반복 가능)', collect)
    .option('--for <duration>', '이 시간이 지나면 자동 종료 (예: 60s, 5m)')
    .option('--until-end', '세션이 종료되면 자동 종료 (--session 필요)')
    .action(async (opts: { session?: string; code?: string[]; for?: string; untilEnd?: boolean }) => {
      const c = ctx();
      const codes = await resolveDeviceCodes(c, opts.code ?? [], opts.session);
      const emitLine = (obj: unknown, human: string) => {
        if (c.json) out.line(JSON.stringify(obj));
        else out.line(human);
      };
      c.devices.onEvent((code, entry) => {
        if (entry.event === 'ack') return; // noise: every command is acked immediately
        emitLine(
          { type: 'event', code, ...entry },
          `${pc.dim(fmtDate(entry.at))} ${pc.cyan(code)} ${entry.direction === 'recv' ? '←' : '→'} ${pc.bold(entry.event)} ${pc.dim(JSON.stringify(entry.payload))}`,
        );
      });
      const states = await connectDevices(c, codes);
      const failed = states.filter((s) => s.status !== 'connected');
      emitLine(
        { type: 'connected', devices: states },
        table(['코드', '상태', '오류'], states.map((s) => [s.code, s.status === 'connected' ? pc.green(s.status) : pc.red(s.status), s.error ?? ''])),
      );
      if (failed.length === states.length) throw new ToolError('연결된 장치가 없습니다. 코드가 진행 중인 세션에 등록되어 있는지 확인해 주세요.', 'device_connect_failed');
      if (!c.json) out.line(pc.dim('받는 커맨드를 출력합니다. Ctrl-C 로 종료합니다.'));

      await new Promise<void>((resolve) => {
        const finish = () => resolve();
        process.once('SIGINT', finish);
        process.once('SIGTERM', finish);
        if (opts.for) setTimeout(finish, parseDuration(opts.for, '--for'));
        if (opts.untilEnd && opts.session) {
          const sessionId = opts.session;
          const poll = setInterval(async () => {
            try {
              const s = await getSession(c, sessionId);
              if (s.state === 'ended') {
                clearInterval(poll);
                finish();
              }
            } catch {
              // transient; keep polling
            }
          }, 2000);
        }
      });
      const dropped = c.devices.disconnect();
      emitLine({ type: 'disconnected', codes: dropped }, pc.dim(`연결 해제: ${dropped.join(', ')}`));
    });

  device
    .command('trigger <code> <event>')
    .description('가상 장치에서 트리거 발생 (연결 → 전송 → 완료 대기 → 해제)')
    .option('--payload <json>', '페이로드 JSON (시퀀스에서 {{payload.x}} 로 사용)')
    .option('--no-wait', '이벤트 실행 완료를 기다리지 않음')
    .option('--timeout <ms>', '완료 대기 시간', '15000')
    .action(async (code: string, event: string, opts: { payload?: string; wait: boolean; timeout: string }) => {
      const c = ctx();
      const payload = opts.payload !== undefined ? readJsonArg(opts.payload, '--payload') : undefined;
      const result = await triggerFromDevice(c, code, event, payload, { wait: opts.wait, timeoutMs: parseInteger(opts.timeout, '--timeout') });
      emit(c, { code, event, ...result }, () => {
        out.ok(`트리거 전송: ${pc.bold(event)} (${code})${result.runsCompleted ? ' — 이벤트 실행 완료' : ''}`);
        if (result.note) out.line(pc.dim(result.note));
      });
    });
}
