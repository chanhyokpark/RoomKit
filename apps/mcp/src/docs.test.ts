import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { normalizeDocname, RAW_DOCS_BASE, readRemoteDoc } from './docs.js';
import { documentationTools } from './tools/docs.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('RoomKit remote documentation', () => {
  it('normalizes linked paths and rejects unsafe paths', () => {
    assert.equal(normalizeDocname('./ai/helper.md'), 'ai/helper.md');
    assert.equal(normalizeDocname('././ai/client API.md'), 'ai/client%20API.md');

    for (const path of [
      '',
      '/',
      '/ai/helper.md',
      '../README.md',
      'ai/../README.md',
      'ai//helper.md',
      'ai\\helper.md',
      'ai/helper.md?raw=1',
      'ai/helper.md#section',
      'ai/helper.txt',
    ]) {
      assert.throws(() => normalizeDocname(path));
    }
  });

  it('reads Markdown from the fixed master-branch URL', async () => {
    let requestedUrl = '';
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response('# Helper', { status: 200 });
    };

    assert.equal(await readRemoteDoc('./ai/helper.md'), '# Helper');
    assert.equal(requestedUrl, `${RAW_DOCS_BASE}ai/helper.md`);
  });

  it('reports HTTP and network failures as tool errors', async () => {
    globalThis.fetch = async () => new Response('missing', { status: 404, statusText: 'Not Found' });
    await assert.rejects(readRemoteDoc('ai/missing.md'), /HTTP 404 Not Found/);

    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    await assert.rejects(readRemoteDoc('TOC_AI.md'), /offline/);
  });

  it('registers docs_list and docs_read with the expected schemas', () => {
    assert.deepEqual(
      documentationTools.map((tool) => tool.name),
      ['docs_list', 'docs_read'],
    );
    assert.deepEqual(documentationTools[0].inputSchema.parse({}), {});
    assert.deepEqual(documentationTools[1].inputSchema.parse({ docname: 'ai/client.md' }), {
      docname: 'ai/client.md',
    });
  });
});
