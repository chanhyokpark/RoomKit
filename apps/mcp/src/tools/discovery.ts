import { z } from 'zod';
import { AssetKindSchema } from '@roomkit/shared';
import { GUIDE } from '../guide.js';
import { defineTool } from '../registry.js';
import { assetKindDoc, commandsDoc } from '../schemas.js';

export const discoveryTools = [
  defineTool({
    name: 'get_started',
    description:
      'RoomKit orientation for agents: core concepts (themes, assets, phases, events, sessions), the authoring workflow, and the test loops. Read this before authoring anything.',
    inputSchema: z.object({}),
    handler: async () => GUIDE,
  }),

  defineTool({
    name: 'describe_commands',
    description:
      'The full JSON Schema for event sequences (the command array in event assets), plus which fields of each command reference which asset kind. Consult before writing or debugging a sequence.',
    inputSchema: z.object({}),
    handler: async () => commandsDoc(),
  }),

  defineTool({
    name: 'describe_asset_kind',
    description:
      'JSON Schema and usage notes for one asset kind\'s data payload and create input. Consult before create_asset/update_asset for that kind.',
    inputSchema: z.object({ kind: AssetKindSchema }),
    handler: async ({ kind }) => assetKindDoc(kind),
  }),
];
