import assert from 'node:assert/strict';
import { it } from 'node:test';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, defineTool, type ToolContext } from './registry.js';

it('returns Markdown strings without JSON quoting and awaits async resources', async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer(
    [
      defineTool({
        name: 'markdown',
        description: 'test',
        inputSchema: z.object({}),
        handler: async () => '# Canonical Markdown',
      }),
    ],
    [
      {
        uri: 'test://markdown',
        name: 'test',
        description: 'test',
        mimeType: 'text/markdown',
        text: async () => '# Async resource',
      },
    ],
    {} as ToolContext,
  );
  const client = new Client({ name: 'registry-test', version: '0.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: 'markdown', arguments: {} }) as {
      content: Array<{ type: string; text?: string }>;
    };
    const block = result.content[0];
    assert.equal(block?.type, 'text');
    assert.equal(block?.text, '# Canonical Markdown');

    const resource = await client.readResource({ uri: 'test://markdown' });
    const contents = resource.contents[0];
    assert.ok(contents && 'text' in contents);
    assert.equal(contents.text, '# Async resource');
  } finally {
    await client.close();
    await server.close();
  }
});
