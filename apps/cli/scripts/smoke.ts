/**
 * End-to-end smoke test: runs the built CLI (dist/index.js) with --json
 * through the authoring + testing loop against a running dev server, in an
 * isolated HOME and project directory. Creates its own theme and deletes it.
 *
 * Prereqs: `pnpm build:cli`, infra + server running.
 *
 *   ROOMKIT_URL=http://localhost:3000 ROOMKIT_ID=admin ROOMKIT_PASSWORD=... pnpm smoke
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const URL = process.env.ROOMKIT_URL ?? 'http://localhost:3000';
const ID = process.env.ROOMKIT_ID ?? 'admin';
const PASSWORD = process.env.ROOMKIT_PASSWORD ?? 'roomkit';
const BIN = join(import.meta.dirname, '..', 'dist', 'index.js');

const execFileAsync = promisify(execFile);
let failed = false;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failed = true;
}

async function main() {
  const home = await mkdtemp(join(tmpdir(), 'rk-smoke-home-'));
  const project = await mkdtemp(join(tmpdir(), 'rk-smoke-proj-'));
  // The CLI must log in explicitly below — drop inherited env credentials.
  const { ROOMKIT_URL: _u, ROOMKIT_ID: _i, ROOMKIT_PASSWORD: _p, ...inherited } = process.env;
  const env = { ...inherited, HOME: home, ROOMKIT_NO_UPDATE_CHECK: '1', CI: '1' };

  async function rk<T = any>(...args: string[]): Promise<T> {
    try {
      const { stdout } = await execFileAsync('node', [BIN, '--json', '--yes', ...args], { cwd: project, env, maxBuffer: 16 * 1024 * 1024 });
      return JSON.parse(stdout) as T;
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message: string };
      throw new Error(`rk ${args.join(' ')} failed: ${e.stderr || e.stdout || e.message}`);
    }
  }
  async function rkFails(...args: string[]): Promise<{ code: number; error: string }> {
    try {
      await execFileAsync('node', [BIN, '--json', '--yes', ...args], { cwd: project, env });
      return { code: 0, error: '' };
    } catch (err) {
      const e = err as { code?: number; stderr?: string };
      return { code: e.code ?? 1, error: e.stderr ?? '' };
    }
  }

  const noLogin = await rkFails('theme', 'list');
  check('not logged in → exit 3', noLogin.code === 3 && /not_logged_in/.test(noLogin.error), noLogin);

  const login = await rk('login', '--url', URL, '--id', ID, '--password', PASSWORD);
  check('login', login.loggedIn === true);

  const themeName = `rk-smoke-${Date.now().toString(36)}`;
  const theme = await rk('theme', 'create', themeName, '--time-limit', '60m', '--use');
  check('theme create --use', typeof theme.id === 'string');
  let importedThemeId: string | null = null;

  try {
    const status = await rk('status');
    check('status shows project theme', status.project?.theme?.id === theme.id, status);

    const tag = await rk('tag', 'create', 'smoke', '--color', '#00cc88');
    check('tag create', typeof tag.id === 'string');

    const device = await rk('asset', 'create', '--kind', 'device', '--name', 'Smoke device', '--key', 'smoke-device', '--code', 'SMOKE1');
    const player = await rk('asset', 'create', '--kind', 'player', '--name', 'Main player', '--key', 'main-player', '--data',
      JSON.stringify({ speakerDeviceId: 'smoke-device', screenDeviceId: 'SMOKE1', subtitleCss: '', dialogueDuckPercent: null, sfxDuckPercent: null }));
    const sfx = await rk('asset', 'create', '--kind', 'sfx', '--name', 'Beep', '--key', 'beep', '--tag', 'smoke');
    const phase = await rk('asset', 'create', '--kind', 'phase', '--name', 'Phase 1', '--key', 'p1');
    const site = await rk('asset', 'create', '--kind', 'website', '--name', 'Site', '--key', 'site', '--website-url', 'http://localhost:5173');
    check('asset create (refs by key/code, tag by name)', player.data.speakerDeviceId === device.id && player.data.screenDeviceId === device.id && sfx.tags[0]?.name === 'smoke' && phase.kind === 'phase' && site.data.mode === 'external');

    const byKey = await rk('asset', 'get', 'beep');
    check('asset get by key', byKey.id === sfx.id);
    const found = await rk('asset', 'list', '--search', 'smoke');
    check('asset list --search', Array.isArray(found) && found.some((a: any) => a.key === 'smoke-device'));
    const dup = await rkFails('asset', 'create', '--kind', 'sfx', '--name', 'dup', '--key', 'beep');
    check('duplicate key rejected', dup.code !== 0 && /beep/.test(dup.error), dup);

    const filePath = join(project, 'note.txt');
    await writeFile(filePath, 'roomkit cli smoke fixture');
    const upload = await rk('upload', filePath, '--set', 'beep');
    check('upload --set', typeof upload.key === 'string' && upload.asset?.id === sfx.id);
    const url = await rk('file', 'url', upload.key);
    check('file url', typeof url.url === 'string');

    const event = await rk('asset', 'create', '--kind', 'event', '--name', 'Smoke event', '--key', 'smoke-event', '--data',
      JSON.stringify({ phaseId: 'p1', triggerKind: 'device', triggerName: 'button:press', manualTriggerable: true, allowReentry: false, once: false, sequence: [] }));
    check('event phaseId resolved by key', event.data.phaseId === phase.id);

    const set = await rk('sequence', 'set', 'smoke-event', '--sequence', JSON.stringify([
      { id: 'beep1', type: 'playSfx', sfxId: 'beep', playerId: 'main-player', waitUntilEnd: true },
      { type: 'wait', durationMs: 50 },
      { type: 'playSfx', sfxId: '00000000-0000-4000-8000-000000000000', playerId: 'main-player', waitUntilEnd: false },
    ]));
    check('sequence set warns on dangling ref', set.entryCount === 3 && set.warnings.length === 1, set.warnings);
    const edit = await rk('sequence', 'edit', 'smoke-event', '--op', JSON.stringify({ op: 'insert', command: { type: 'notify', message: 'hi' }, id: 'n1', before: 'beep1' }), '--op', JSON.stringify({ op: 'remove', target: 3 }));
    check('sequence edit (insert before, remove index)', edit.entryCount === 3 && edit.warnings.length === 0, edit);
    const outline = await rk('sequence', 'get', 'smoke-event', '--outline');
    check('sequence outline', outline.outline[0].startsWith('[0] id=n1 notify'), outline.outline);
    const valid = await rk('sequence', 'validate', '--sequence', JSON.stringify([{ type: 'wait', durationMs: 5 }]));
    check('sequence validate', valid.valid === true);

    // Deploy: fake dist.
    const siteDir = join(project, 'site', 'dist');
    await mkdir(siteDir, { recursive: true });
    await writeFile(join(siteDir, 'index.html'), '<h1>smoke</h1>');
    const deploy = await rk('deploy', '--dir', 'site', '--asset', 'site', '--dist', 'dist', '--build-command', 'echo build', '--save', '--name', 'main');
    check('deploy ad-hoc --save', deploy.deployed.length === 1 && deploy.failed.length === 0 && /\/api\/sites\//.test(deploy.deployed[0].url), deploy);
    const redeploy = await rk('deploy', 'main', '--no-build');
    check('deploy from roomkit.json', redeploy.deployed[0]?.assetId === site.id, redeploy);
    const hosted = await rk('asset', 'get', 'site');
    check('asset switched to hosted', hosted.data.mode === 'hosted');
    const served = await fetch(deploy.deployed[0].url);
    check('hosted site served', served.ok && (await served.text()).includes('smoke'));

    // Skill install.
    const skill = await rk('skill', 'install', '--tools', 'claude,codex');
    check('skill install', skill.installed.length === 2);
    const skillStatus = await rk('skill', 'status');
    check('skill status', skillStatus.tools.every((t: any) => t.installed));

    // Session + virtual device loop.
    const created = await rk('session', 'create');
    const sessionId: string = created.session.id;
    const code: string = created.generatedDeviceCodes[0].code;
    check('session create generates codes', typeof code === 'string');

    const connect = spawn('node', [BIN, '--json', 'device', 'connect', '--session', sessionId, '--until-end', '--for', '60s'], { cwd: project, env, stdio: ['ignore', 'pipe', 'inherit'] });
    let stream = '';
    connect.stdout.on('data', (c: Buffer) => (stream += c.toString()));
    await new Promise((r) => setTimeout(r, 2500));
    check('device connect streams connected line', /"type":"connected"/.test(stream), stream);

    const started = await rk('session', 'start', sessionId);
    check('session start', started.state === 'running');
    const trig = await rk('device', 'trigger', code, 'button:press');
    check('device trigger completes runs', trig.delivered && trig.runsCompleted, trig);
    const manual = await rk('session', 'trigger', sessionId, 'smoke-event');
    check('session trigger', manual.triggered === event.id);
    const cmd = await rk('session', 'command', sessionId, '--command', JSON.stringify({ type: 'notify', message: 'from cli' }));
    check('session command', cmd.dispatched === 'notify');
    const logs = await rk('session', 'logs', sessionId);
    check('session logs show trigger, event, and operator command', logs.logs.some((l: any) => /button:press/.test(l.message)) && logs.logs.some((l: any) => /started/.test(l.message)) && logs.logs.some((l: any) => /from cli/.test(l.message)), logs.logs.map((l: any) => l.message));
    const runs = await rk('session', 'runs', sessionId);
    check('session runs', runs.sessionId === sessionId && Array.isArray(runs.runs), runs);
    const ended = await rk('session', 'end', sessionId);
    check('session end', ended.state === 'ended');
    await new Promise<void>((r) => connect.on('close', () => r()));
    check('device connect exits on session end', /"type":"disconnected"/.test(stream) && /"event":"command"/.test(stream), stream);
    const summary = await rk('session', 'summary', sessionId);
    check('session summary', summary.sessionId === sessionId);
    const deleted = await rk('session', 'delete', sessionId);
    check('session delete', deleted.deleted === sessionId);

    // Archive round-trip.
    const exported = await rk('theme', 'export', '-o', join(project, 'theme.zip'));
    check('theme export', exported.bytes > 0);
    const imported = await rk('theme', 'import', join(project, 'theme.zip'));
    importedThemeId = imported.id;
    check('theme import', imported.name === themeName && imported.id !== theme.id);

    const docs = await rk('docs', 'list');
    check('docs list (bundled skill)', docs.files.includes('references/cli.md'));
    const describe = await rk('describe', 'asset', 'website');
    check('describe asset', describe.kind === 'website');
  } finally {
    await rk('theme', 'delete', theme.id).catch((e) => check('cleanup theme', false, e.message));
    if (importedThemeId) await rk('theme', 'delete', importedThemeId).catch((e) => check('cleanup imported theme', false, e.message));
  }

  console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE OK');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
