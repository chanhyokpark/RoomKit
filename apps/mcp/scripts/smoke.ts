/**
 * End-to-end smoke test: drives the built MCP server (dist/index.js) as a
 * real MCP client through the full authoring + testing loop against a running
 * dev server. Creates its own theme and deletes it afterwards.
 *
 * Prereqs: `pnpm build` here, infra + server running (`./compose.sh`,
 * `pnpm dev:server`).
 *
 *   ROOMKIT_URL=http://localhost:3000 ROOMKIT_ID=admin ROOMKIT_PASSWORD=... pnpm smoke
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const URL = process.env.ROOMKIT_URL ?? 'http://localhost:3000';
const ID = process.env.ROOMKIT_ID ?? 'admin';
const PASSWORD = process.env.ROOMKIT_PASSWORD ?? 'roomkit';

const client = new Client({ name: 'smoke', version: '0.0.0' });

let failed = false;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failed = true;
}

async function call<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Array<{ type: string; text: string }>;
  };
  const text = res.content[0]?.text ?? '';
  if (res.isError) throw new Error(`${name} failed: ${text}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

async function main() {
  await client.connect(
    new StdioClientTransport({
      command: 'node',
      args: [join(import.meta.dirname, '..', 'dist', 'index.js')],
    }),
  );

  const login = await call('login', { url: URL, id: ID, password: PASSWORD });
  check('login', login.loggedIn === true);

  const themeName = `mcp-smoke-${Date.now().toString(36)}`;
  const theme = await call('create_theme', { name: themeName, timeLimitMs: 3_600_000 });
  check('create_theme', typeof theme.id === 'string');

  try {
    const selected = await call('select_theme', { name: themeName });
    check('select_theme', selected.selected.id === theme.id);

    const tag = await call('manage_tag', { action: 'create', name: 'smoke', color: '#00cc88' });
    check('manage_tag create', typeof tag.id === 'string');

    // Local-file upload through presign + PUT.
    const dir = await mkdtemp(join(tmpdir(), 'roomkit-smoke-'));
    const filePath = join(dir, 'note.txt');
    await writeFile(filePath, 'roomkit mcp smoke fixture');
    const upload = await call('upload_file', { filePath });
    check('upload_file', typeof upload.key === 'string' && upload.size > 0);
    const fileUrl = await call('get_file_url', { key: upload.key });
    check('get_file_url', typeof fileUrl.url === 'string');

    const device = await call('create_asset', {
      asset: {
        kind: 'device',
        name: 'smoke-device',
        key: 'smoke-device',
        code: 'SMOKE1',
        data: { displayName: 'Smoke Device', isHintDevice: false, hintCodeCss: '' },
      },
    });
    const player = await call('create_asset', {
      asset: {
        kind: 'player',
        name: 'smoke-player',
        key: 'main-player',
        data: {
          // Refs by key / code instead of uuid.
          speakerDeviceId: 'smoke-device',
          screenDeviceId: 'SMOKE1',
          subtitleCss: '',
          dialogueDuckPercent: null,
          sfxDuckPercent: null,
        },
      },
    });
    const phase = await call('create_asset', {
      asset: { kind: 'phase', name: 'phase-1', data: { order: 1 } },
    });
    const sfx = await call('create_asset', {
      asset: {
        kind: 'sfx',
        name: 'smoke-beep',
        key: 'beep',
        data: { fileKey: null, durationMs: 500 },
      },
    });
    check(
      'create_asset device/player/phase/sfx',
      [device, player, phase, sfx].every((a) => typeof a.id === 'string'),
    );
    check(
      'create_asset stores key and resolves data refs by key/code',
      sfx.key === 'beep' && player.data.speakerDeviceId === device.id && player.data.screenDeviceId === device.id,
      player.data,
    );
    const byKey = await call('get_asset', { assetId: 'beep' });
    const byName = await call('get_asset', { assetId: 'smoke-player' });
    check('get_asset by key / by name', byKey.id === sfx.id && byName.id === player.id);
    const dupKey = await call('create_asset', {
      asset: { kind: 'sfx', name: 'dup', key: 'beep', data: { fileKey: null, durationMs: 1 } },
    }).catch((err: Error) => err.message);
    check('duplicate key rejected', typeof dupKey === 'string' && /Key "beep" already exists/.test(dupKey), dupKey);
    const found = await call('list_assets', { search: 'smoke' });
    check('list_assets search', Array.isArray(found) && found.length === 3 && found.some((a: any) => a.key === 'beep'), found);

    const event = await call('create_asset', {
      asset: {
        kind: 'event',
        name: 'smoke-event',
        key: 'smoke-event',
        data: {
          phaseId: null,
          triggerKind: 'device',
          triggerName: 'button:press',
          manualTriggerable: true,
          allowReentry: false,
          once: false,
          sequence: [],
        },
      },
    });

    // Entry ids: one custom, the rest omitted; refs by key; one deliberately dangling ref.
    const danglingId = randomUUID();
    const seq = await call('set_event_sequence', {
      eventId: 'smoke-event',
      sequence: [
        { id: 'hello', type: 'notify', message: 'smoke says hi' },
        { type: 'playSfx', sfxId: 'beep', playerId: 'main-player', waitUntilEnd: true },
        { type: 'playSfx', sfxId: danglingId, playerId: 'main-player', waitUntilEnd: false },
      ],
    });
    check('set_event_sequence saved', seq.saved && seq.entryCount === 3, seq);
    check(
      'set_event_sequence dangling-ref warning',
      seq.warnings.some((w: string) => w.includes(danglingId)),
      seq.warnings,
    );
    const full = await call('get_event_sequence', { eventId: 'smoke-event' });
    check(
      'get_event_sequence resolves refs to uuids + legend',
      full.sequence[0].id === 'hello' &&
        full.sequence[1].sfxId === sfx.id &&
        full.sequence[1].playerId === player.id &&
        /beep/.test(full.refs[sfx.id]),
      full,
    );
    const badRef = await call('validate_sequence', {
      sequence: [{ type: 'playSfx', sfxId: 'no-such-sfx', playerId: 'main-player', waitUntilEnd: false }],
    }).catch((err: Error) => err.message);
    check('unknown ref rejected', typeof badRef === 'string' && /no sfx matches "no-such-sfx"/.test(badRef), badRef);

    const edited = await call('edit_event_sequence', {
      eventId: 'smoke-event',
      ops: [
        { op: 'update', target: 'hello', patch: { message: 'edited' } },
        { op: 'insert', command: { type: 'notify', message: 'temporary' }, id: 'temp', at: 0 },
        { op: 'remove', target: 'temp' },
        { op: 'insert', command: { type: 'wait', durationMs: 10 }, id: 'pause', after: 'hello' },
        { op: 'move', target: 'pause', at: 0 },
      ],
    });
    const outline = await call('get_event_sequence', { eventId: 'smoke-event', view: 'outline' });
    check(
      'edit_event_sequence ops applied',
      edited.saved && edited.warnings.length === 1 && edited.entryCount === 4 && outline.outline.length === 4 &&
        /^\[0\] id=pause wait/.test(outline.outline[0]) && /^\[1\] id=hello notify.*"edited"/.test(outline.outline[1]),
      { edited, outline },
    );
    const badOp = await call('edit_event_sequence', {
      eventId: 'smoke-event',
      ops: [{ op: 'remove', target: 'nope' }],
    }).catch((err: Error) => err.message);
    check('edit_event_sequence bad target rejected, nothing written', typeof badOp === 'string' && /no entry with id "nope"/.test(badOp), badOp);

    const validate = await call('validate_sequence', {
      sequence: [{ type: 'switchPhase', phaseId: 'phase-1' }],
    });
    check('validate_sequence clean', validate.valid && validate.warnings.length === 0, validate.warnings);

    const created = await call('create_session', {});
    const sessionId = created.session.id;
    check('create_session auto codes', created.generatedDeviceCodes?.length === 1, created);

    const connected = await call('connect_virtual_devices', { sessionId });
    check(
      'connect_virtual_devices',
      connected.results.every((r: any) => r.status === 'connected'),
      connected.results,
    );

    const started = await call('control_session', { sessionId, action: { type: 'start' } });
    check('control_session start', started.state === 'running', started);

    const code = created.generatedDeviceCodes[0].code;
    const trigger = await call('emit_device_trigger', { code, event: 'button:press' });
    check('emit_device_trigger runs completed', trigger.runsCompleted === true, trigger);

    const logs = await call('get_session_logs', { sessionId });
    const messages = logs.logs.map((l: any) => `${l.kind}:${l.message}`);
    check(
      'session logs show the event run',
      logs.logs.some((l: any) => l.kind === 'event') && logs.logs.some((l: any) => l.kind === 'command'),
      messages,
    );
    check(
      'dangling command skipped in logs',
      logs.logs.some((l: any) => l.kind === 'command' && l.message.includes('skipped')),
      messages,
    );

    const deviceState = await call('get_virtual_device_state', { code });
    check(
      'virtual device received + acked the sfx command',
      deviceState.log.some((e: any) => e.event === 'command') &&
        deviceState.log.some((e: any) => e.event === 'ack'),
      deviceState.log.map((e: any) => `${e.direction}:${e.event}`),
    );

    const context = await call('get_context', {});
    check('get_context', context.selectedTheme?.id === theme.id && context.activeSessions.length >= 1);

    const ended = await call('control_session', { sessionId, action: { type: 'end' } });
    check('control_session end', ended.state === 'ended', ended);
    const summary = await call('get_session_summary', { sessionId });
    check('get_session_summary', summary !== null && typeof summary === 'object');

    await call('disconnect_virtual_devices', {});
  } finally {
    const deleted = await call('delete_theme', { themeId: theme.id }).catch((err) => {
      check('delete_theme cleanup', false, String(err));
      return null;
    });
    if (deleted) check('delete_theme cleanup', deleted.deleted === theme.id);
    await client.close();
  }

  if (failed) {
    console.error('\nSMOKE FAILED');
    process.exit(1);
  }
  console.log('\nSMOKE PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
