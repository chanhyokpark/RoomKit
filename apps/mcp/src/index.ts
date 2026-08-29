import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readRemoteDoc } from './docs.js';
import { ApiClient } from './http.js';
import { createServer, type ResourceDef, type ToolContext } from './registry.js';
import { commandsDoc } from './schemas.js';
import { SessionState } from './session.js';
import { VirtualDeviceManager } from './virtual-device.js';
import { assetTools } from './tools/assets.js';
import { connectionTools } from './tools/connection.js';
import { deployTools } from './tools/deploy.js';
import { deviceTools } from './tools/devices.js';
import { discoveryTools } from './tools/discovery.js';
import { documentationTools } from './tools/docs.js';
import { sequenceTools } from './tools/sequences.js';
import { sessionTools } from './tools/sessions.js';
import { tagTools } from './tools/tags.js';
import { themeTools } from './tools/themes.js';
import { uploadTools } from './tools/uploads.js';

const state = new SessionState();
const ctx: ToolContext = {
  state,
  api: new ApiClient(state),
  devices: new VirtualDeviceManager(state),
};

const tools = [
  ...documentationTools,
  ...connectionTools,
  ...discoveryTools,
  ...themeTools,
  ...tagTools,
  ...assetTools,
  ...uploadTools,
  ...deployTools,
  ...sequenceTools,
  ...sessionTools,
  ...deviceTools,
];

const resources: ResourceDef[] = [
  {
    uri: 'roomkit://guide',
    name: 'RoomKit guide',
    description: 'Canonical AI documentation table of contents (same as docs_list/get_started).',
    mimeType: 'text/markdown',
    text: () => readRemoteDoc('TOC_AI.md'),
  },
  {
    uri: 'roomkit://schema/commands',
    name: 'Sequence command schema',
    description: 'JSON Schema and notes for event sequences (same as describe_commands).',
    mimeType: 'application/json',
    text: () => JSON.stringify(commandsDoc(), null, 2),
  },
];

const server = createServer(tools, resources, ctx);

async function main() {
  await server.connect(new StdioServerTransport());
  // stdout is the MCP stream — diagnostics must go to stderr.
  console.error(`roomkit-mcp ready (${tools.length} tools)`);
}

main().catch((err) => {
  console.error('roomkit-mcp failed to start:', err);
  process.exit(1);
});
