import type { Command } from 'commander';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import pc from 'picocolors';
import { playerTestLink, type Asset, type SessionResponse } from '@roomkit/shared';
import type { CliContext } from '../context.js';
import { isReachable, lanAddress, openExternal } from '../core/open.js';
import { controlSession, createSession, getSession, getSessionLogs } from '../core/ops/sessions.js';
import { ThemeIndex } from '../core/refs.js';
import { ToolError } from '../core/session.js';
import { saveProject, type WebsiteEntry } from '../project/config.js';
import { resolveThemeId } from '../project/theme.js';
import { kv, out, table } from '../ui/output.js';
import { multiselect, spinner } from '../ui/prompt.js';
import { formatLogLine } from './session.js';
import { emit, type GetContext } from './util.js';

interface DevFlags {
  devices?: string;
  allDevices?: boolean;
  host?: string;
  player?: string;
  devServer: boolean;
  open: boolean;
  detach?: boolean;
  start?: boolean;
  save?: boolean;
  waitTimeout: string;
}

type DeviceAsset = Extract<Asset, { kind: 'device' }>;

interface DevServer {
  entry: WebsiteEntry;
  url: string;
  child: ChildProcess | null;
  /** True when this run started the process (and will stop it). */
  started: boolean;
}

/** Websites that take part in a dev session: named ones, or every entry with a `dev` block. */
function selectWebsites(ctx: CliContext, names: string[]): { root: string; entries: WebsiteEntry[] } {
  const project = ctx.project;
  if (!project) throw new ToolError('roomkit.json 이 없습니다. rk init 으로 프로젝트를 만들어 주세요.', 'no_project');
  const websites = project.config.websites;
  const entries = names.length
    ? names.map((n) => {
        const e = websites.find((w) => w.name === n);
        if (!e) throw new ToolError(`websites 에 "${n}" 항목이 없습니다. (있는 항목: ${websites.map((w) => w.name).join(', ')})`, 'usage');
        if (!e.dev) throw new ToolError(`websites."${n}" 에 dev 설정이 없습니다. roomkit.json 에 "dev": { "command": "pnpm dev", "url": "http://localhost:5173" } 을 추가해 주세요.`, 'usage');
        return e;
      })
    : websites.filter((w) => w.dev);
  if (!entries.length) {
    throw new ToolError(
      websites.length
        ? 'dev 설정이 있는 websites 항목이 없습니다. roomkit.json 의 항목에 "dev": { "command": "pnpm dev", "url": "http://localhost:5173" } 을 추가해 주세요.'
        : 'roomkit.json 에 websites 항목이 없습니다. rk init 으로 웹사이트를 추가해 주세요.',
      'usage',
    );
  }
  return { root: project.root, entries };
}

/** `--host`: rewrite loopback dev URLs so a Player on another machine can reach them. */
function rewriteHost(url: string, host: string | undefined): string {
  if (!host) return url;
  const target = host === 'auto' ? lanAddress() : host;
  if (!target) throw new ToolError('LAN 주소를 찾지 못했습니다. --host <ip> 로 직접 지정해 주세요.', 'no_lan_address');
  const u = new URL(url);
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(u.hostname)) u.hostname = target;
  return u.toString().replace(/\/$/, '');
}

async function chooseDevices(ctx: CliContext, index: ThemeIndex, flags: DevFlags, websiteAssetIds: Set<string>): Promise<DeviceAsset[]> {
  const all = index.assets.filter((a): a is DeviceAsset => a.kind === 'device');
  if (!all.length) throw new ToolError('테마에 장치 애셋이 없습니다. rk asset create --kind device 로 먼저 만들어 주세요.', 'no_devices');
  const byRefs = (refs: string[], where: string) =>
    refs.map((ref) => {
      const id = index.resolveAssetId(ref, 'device', where);
      return all.find((d) => d.id === id)!;
    });
  if (flags.allDevices) return all;
  if (flags.devices) return byRefs(flags.devices.split(',').map((s) => s.trim()).filter(Boolean), '--devices');
  const configured = ctx.project?.config.test?.devices ?? [];
  if (configured.length) return byRefs(configured, 'roomkit.json test.devices');
  // Auto: devices whose starting webpage is one of the dev websites.
  const auto = all.filter((d) => d.data.startWebsite && websiteAssetIds.has(d.data.startWebsite.websiteId));
  if (auto.length) return auto;
  if (ctx.interactive()) {
    const chosen = await multiselect(
      ctx,
      ['--devices', '--all-devices'],
      '테스트 세션에서 열 장치 (roomkit.json 의 test.devices 로 저장하려면 --save)',
      all.map((d) => ({ value: d.id, label: d.data.displayName || d.name, hint: d.key ?? d.code ?? undefined })),
      all.map((d) => d.id),
      true,
    );
    return all.filter((d) => chosen.includes(d.id));
  }
  ctx.warn('개발 웹사이트를 시작 페이지로 쓰는 장치가 없어 모든 장치를 엽니다. --devices 또는 roomkit.json 의 test.devices 로 지정할 수 있습니다.');
  return all;
}

function startDevServer(root: string, entry: WebsiteEntry): ChildProcess {
  const child = spawn(entry.dev!.command!, {
    cwd: resolve(root, entry.dir),
    shell: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    // Own process group so the whole shell → vite tree can be stopped at once.
    detached: process.platform !== 'win32',
    env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? '1' },
  });
  return child;
}

function stopDevServer(server: DevServer): void {
  const child = server.child;
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
}

async function waitFor(server: DevServer, timeoutMs: number, onTick?: (elapsed: number) => void): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    if (server.child && server.child.exitCode !== null) {
      throw new ToolError(`${server.entry.name}: 개발 서버가 종료되었습니다 (exit ${server.child.exitCode}).`, 'dev_server_failed');
    }
    if (await isReachable(server.url)) return;
    const elapsed = Date.now() - startedAt;
    if (elapsed > timeoutMs) throw new ToolError(`${server.entry.name}: ${server.url} 이 ${Math.round(timeoutMs / 1000)}초 안에 응답하지 않았습니다. dev.url 이 실제 포트와 맞는지 확인해 주세요.`, 'dev_server_timeout');
    onTick?.(elapsed);
    await new Promise((r) => setTimeout(r, 500));
  }
}

function waitForSignal(): { promise: Promise<'signal'>; dispose: () => void } {
  let onSignal: () => void = () => {};
  const promise = new Promise<'signal'>((resolve) => {
    onSignal = () => resolve('signal');
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  });
  return {
    promise,
    dispose: () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    },
  };
}

export function register(program: Command, ctx: GetContext): void {
  program
    .command('dev [names...]')
    .description('개발 서버를 띄우고 Player 에서 테스트 세션을 엽니다 (roomkit.json 의 websites[].dev 와 test.devices 기준)')
    .option('--devices <refs>', '열 장치 (쉼표 구분 uuid/키/코드/이름; 기본: roomkit.json test.devices, 없으면 개발 웹사이트를 시작 페이지로 쓰는 장치)')
    .option('--all-devices', '테마의 모든 장치')
    .option('--host <host>', '대체 URL 의 localhost 를 이 주소로 바꿈 (다른 기기의 Player 용; auto = 이 컴퓨터의 LAN 주소)')
    .option('--player <id>', '앱 링크 대신 서버에 연결된 Player 런처 id 로 창을 엶')
    .option('--no-dev-server', '개발 서버를 실행하지 않음 (이미 떠 있다고 가정)')
    .option('--no-open', '앱 링크를 열지 않고 출력만')
    .option('--detach', '세션을 만들고 바로 종료 (로그 출력·자동 종료 없음; --json 의 기본)')
    .option('--start', '세션을 생성 직후 시작 (기본: 디버그 창에서 시작)')
    .option('--save', '--devices 를 roomkit.json 의 test.devices 로 저장')
    .option('--wait-timeout <seconds>', '개발 서버 응답 대기 시간', '60')
    .action(async (names: string[], opts: DevFlags) => {
      const c = ctx();
      const detach = opts.detach || c.json;
      const { root, entries } = selectWebsites(c, names);
      const themeId = await resolveThemeId(c);
      const index = await ThemeIndex.load(c, themeId);
      const websiteAssetIds = new Set(entries.map((e) => e.assetId));
      const devices = await chooseDevices(c, index, opts, websiteAssetIds);
      if (!devices.length) throw new ToolError('열 장치가 없습니다.', 'usage');

      if (opts.save && (opts.devices || opts.allDevices) && c.project) {
        const refs = devices.map((d) => d.key ?? d.id);
        saveProject(c.project.root, { ...c.project.config, test: { ...c.project.config.test, devices: refs } });
        c.reloadProject();
      }

      // Dev servers: probe first; start the ones that are down (unless told not to).
      const servers: DevServer[] = entries.map((entry) => ({ entry, url: entry.dev!.url.replace(/\/+$/, ''), child: null, started: false }));
      const signal = waitForSignal();
      const cleanup = () => {
        for (const s of servers) if (s.started) stopDevServer(s);
      };
      try {
        for (const server of servers) {
          const up = await isReachable(server.url);
          if (up) continue;
          if (!opts.devServer || detach || !server.entry.dev!.command) {
            c.warn(`${server.entry.name}: ${server.url} 이 응답하지 않습니다. 개발 서버를 먼저 실행해 주세요 (${server.entry.dev!.command ?? 'dev 명령 없음'}).`);
            continue;
          }
          if (!c.json) out.info(`${server.entry.name}: 개발 서버 시작 — ${pc.dim(server.entry.dev!.command)} (${resolve(root, server.entry.dir)})`);
          server.child = startDevServer(root, server.entry);
          server.started = true;
          const s = spinner(c, `${server.entry.name}: ${server.url} 응답 대기 중`);
          try {
            await Promise.race([
              waitFor(server, Number(opts.waitTimeout) * 1000),
              signal.promise.then(() => {
                throw new ToolError('cancelled', 'cancelled');
              }),
            ]);
            s.stop(`${server.entry.name}: ${server.url} 응답 확인`);
          } catch (err) {
            s.fail(`${server.entry.name}: 개발 서버 대기 실패`);
            throw err;
          }
        }

        // Session: codes minted here (app link) or by the server (--player).
        const urlOverrides = servers.map((s) => ({ websiteId: s.entry.assetId, url: rewriteHost(s.url, opts.host) }));
        const codes = opts.player ? undefined : devices.map((d) => ({ deviceId: d.id, code: `rk-${randomUUID().slice(0, 12)}` }));
        const { session } = await createSession(c, {
          themeId,
          mode: 'test',
          deviceCodes: codes,
          playerId: opts.player,
          deviceIds: opts.player ? devices.map((d) => d.id) : undefined,
          urlOverrides,
        });
        let started = false;
        if (opts.start) {
          await controlSession(c, session.id, { type: 'start' });
          started = true;
        }
        await c.api.ensureLogin();
        const link = playerTestLink(c.state.apiUrl!, session.id);
        const deviceCodes = (session.testDeviceCodes ?? []).map((d) => ({ deviceId: d.deviceId, deviceName: d.deviceName, displayName: d.displayName, code: d.code }));

        let opened: boolean | null = null;
        if (opts.open && !opts.player) {
          opened = await openExternal(link);
          if (!opened) c.warn('앱 링크를 여는 데 실패했습니다. Player 가 설치되어 있고 한 번 이상 실행되었는지 확인하거나, Player 테스트 탭의 "세션 ID로 열기"에 세션 id 를 붙여 넣어 주세요.');
        }

        const result = {
          session,
          link,
          opened,
          started,
          player: opts.player ?? null,
          devices: deviceCodes,
          urlOverrides: urlOverrides.map((o) => ({ ...o, website: entries.find((e) => e.assetId === o.websiteId)?.name ?? null })),
          devServers: servers.map((s) => ({ name: s.entry.name, url: s.url, started: s.started })),
        };
        emit(c, result, () => {
          out.ok(`테스트 세션 생성: ${pc.bold(session.id)}${started ? ' — 시작됨' : ''}`);
          out.line(
            kv([
              ['앱 링크', link],
              ['Player', opts.player ? `${opts.player} (서버가 창을 엶)` : opened ? '앱 링크로 열림' : opened === false ? '열기 실패' : '열지 않음 (--no-open)'],
            ]),
          );
          out.line(table(['웹사이트', '대체 URL'], result.urlOverrides.map((o) => [o.website ?? o.websiteId, o.url])));
          if (deviceCodes.length) out.line(table(['장치', '코드'], deviceCodes.map((d) => [d.displayName || d.deviceName, d.code])));
          if (!opts.player) out.line(pc.dim(`Player 가 열리지 않으면: Player 테스트 탭 → "세션 ID로 열기" 에 ${session.id} 붙여 넣기`));
          if (!started) out.line(pc.dim('세션 시작은 Player 디버그 창(또는 rk session start) 에서 합니다.'));
        });

        if (detach) {
          if (!c.json) out.line(pc.dim(`종료: rk session end ${session.id}`));
          return;
        }

        // Foreground: stream logs until Ctrl-C (ends the session) or the session ends elsewhere.
        if (!c.json) out.line(pc.dim('세션 로그를 출력합니다. Ctrl-C 로 세션을 종료합니다.'));
        let afterId: number | undefined;
        let endedElsewhere = false;
        const follow = (async () => {
          for (;;) {
            const logs = await getSessionLogs(c, session.id, { afterId, limit: 500 }).catch(() => null);
            if (logs) {
              for (const l of logs.logs) out.line(formatLogLine(l));
              afterId = logs.nextAfterId;
            }
            const state = await getSession(c, session.id).catch(() => null);
            if (state?.state === 'ended') {
              endedElsewhere = true;
              return 'ended' as const;
            }
            for (const s of servers) {
              if (s.started && s.child && s.child.exitCode !== null) throw new ToolError(`${s.entry.name}: 개발 서버가 종료되었습니다 (exit ${s.child.exitCode}).`, 'dev_server_failed');
            }
            await new Promise((r) => setTimeout(r, 1000));
          }
        })();
        const outcome = await Promise.race([follow, signal.promise]);
        if (outcome === 'signal' || !endedElsewhere) {
          out.line();
          const current: SessionResponse | null = await getSession(c, session.id).catch(() => null);
          if (current && current.state !== 'ended') {
            await controlSession(c, session.id, { type: 'end' });
            out.ok(`세션 종료: ${session.id}`);
          }
        } else {
          out.info(`세션이 종료되었습니다: ${session.id}`);
        }
      } finally {
        signal.dispose();
        cleanup();
      }
    });
}
