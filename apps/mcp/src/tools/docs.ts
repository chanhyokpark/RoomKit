import { z } from 'zod';
import { readRemoteDoc } from '../docs.js';
import { defineTool } from '../registry.js';

export const documentationTools = [
  defineTool({
    name: 'docs_list',
    description:
      'Read the canonical AI documentation table of contents from RoomKit master. Call this first, then pass one of its linked paths to docs_read.',
    inputSchema: z.object({}),
    handler: async () => readRemoteDoc('TOC_AI.md'),
  }),

  defineTool({
    name: 'docs_read',
    description:
      'Read one canonical RoomKit Markdown document from the repository master branch. Use a relative path from docs_list, such as ai/helper.md.',
    inputSchema: z.object({
      docname: z
        .string()
        .min(1)
        .describe('Relative Markdown path below docs/, copied from docs_list (for example ai/helper.md)'),
    }),
    handler: async ({ docname }) => readRemoteDoc(docname),
  }),
];
