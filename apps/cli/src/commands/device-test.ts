import type { Command } from 'commander';
import pc from 'picocolors';
import type { SessionDeviceStatus } from '@roomkit/shared';
import { listSessionDevices, reloadDevice, resolveSessionDevice, waitForDevicesReady, windowDevice } from '../core/ops/devices.js';
import { ToolError } from '../core/session.js';
import { parseInteger } from '../ui/json-input.js';
import { out, table } from '../ui/output.js';
import { finishWithScreenshot, focusBeforehand, prepareScreenshotPath } from './device-eval.js';
import { emit, fmtDate, type GetContext } from './util.js';

function describeStatus(d: SessionDeviceStatus): string {
  if (!d.online) return pc.red('오프라인');
  if (d.windows > 1) return pc.yellow(`창 ${d.windows}개`);
  if (d.website && d.helperVersion === undefined) return pc.yellow('Helper 대기');
  return d.ready ? pc.green('준비됨') : pc.yellow('미준비');
}

/** Test-only Player window and website controls (focus, screenshot, reload, status). */
export function registerDeviceTest(device: Command, ctx: GetContext): void {
  device
    .command('focus <device>')
    .description('테스트 Player 창을 앞으로 가져옴 (표시·최소화 해제·포커스·렌더링 대기)')
    .requiredOption('--session <id>', '테스트 세션 UUID')
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
    .description('테스트 Player 창을 새로 캡처해 PNG/JPEG 로 저장 (웹사이트가 없어도 동작)')
    .requiredOption('--session <id>', '테스트 세션 UUID')
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
    .description('테스트 Player 가 보여주는 웹사이트를 강제 새로고침 (iframe 재생성)')
    .requiredOption('--session <id>', '테스트 세션 UUID')
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
    .description('세션 장치의 연결·Helper·웹사이트 상태 (eval 가능 여부 진단)')
    .requiredOption('--session <id>', '세션 UUID')
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
}
