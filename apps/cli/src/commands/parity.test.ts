import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Command } from 'commander';
import { createProgram } from '../program.js';

/** Every MCP server tool and the rk command that covers it (see docs: skills/roomkit/references/cli.md). */
const PARITY: Record<string, string> = {
  docs_list: 'docs list',
  docs_read: 'docs read',
  get_started: 'docs list',
  login: 'login',
  select_theme: 'theme use',
  get_context: 'status',
  describe_commands: 'describe commands',
  describe_asset_kind: 'describe asset',
  list_themes: 'theme list',
  create_theme: 'theme create',
  update_theme: 'theme update',
  delete_theme: 'theme delete',
  duplicate_theme: 'theme duplicate',
  list_tags: 'tag list',
  manage_tag: 'tag create',
  list_assets: 'asset list',
  get_asset: 'asset get',
  create_asset: 'asset create',
  update_asset: 'asset update',
  delete_asset: 'asset delete',
  upload_file: 'upload',
  get_file_url: 'file url',
  deploy_website: 'deploy',
  get_event_sequence: 'sequence get',
  edit_event_sequence: 'sequence edit',
  set_event_sequence: 'sequence set',
  validate_sequence: 'sequence validate',
  create_session: 'session create',
  control_session: 'session start',
  run_session_command: 'session command',
  list_session_runs: 'session runs',
  abort_session_run: 'session abort',
  list_sessions: 'session list',
  get_session: 'session get',
  get_session_summary: 'session summary',
  get_session_logs: 'session logs',
  delete_session: 'session delete',
  connect_virtual_devices: 'device connect',
  get_virtual_device_state: 'device connect',
  emit_device_trigger: 'device trigger',
  disconnect_virtual_devices: 'device connect',
};

function find(root: Command, path: string): Command | undefined {
  let cmd: Command | undefined = root;
  for (const part of path.split(' ')) {
    cmd = cmd?.commands.find((c) => c.name() === part || c.aliases().includes(part));
  }
  return cmd;
}

describe('MCP tool parity', () => {
  it('maps all 41 MCP tools to registered rk commands', () => {
    const { program } = createProgram();
    assert.equal(Object.keys(PARITY).length, 41);
    const missing = Object.entries(PARITY).filter(([, path]) => !find(program, path)).map(([tool, path]) => `${tool} → rk ${path}`);
    assert.deepEqual(missing, []);
  });

  it('also registers the CLI-only commands', () => {
    const { program } = createProgram();
    for (const path of ['init', 'skill install', 'theme export', 'theme import', 'import media', 'doctor', 'upgrade', 'version', 'logout', 'whoami']) {
      assert.ok(find(program, path), `missing rk ${path}`);
    }
  });
});
