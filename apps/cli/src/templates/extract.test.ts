import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { archiveUrl } from './download.js';
import { extractTemplate } from './extract.js';

describe('template extraction', () => {
  it('extracts only the requested template, stripping the archive root and junk', async () => {
    const zip = zipSync({
      'RoomKit-master/README.md': strToU8('root'),
      'RoomKit-master/templates/web/package.json': strToU8('{"name":"t"}'),
      'RoomKit-master/templates/web/src/App.tsx': strToU8('app'),
      'RoomKit-master/templates/web/node_modules/x/index.js': strToU8('junk'),
      'RoomKit-master/templates/web/.DS_Store': strToU8('junk'),
      'RoomKit-master/templates/web_svelte/package.json': strToU8('{"name":"s"}'),
    });
    const dest = mkdtempSync(join(tmpdir(), 'rk-tpl-'));
    const files = await extractTemplate(zip, 'web', dest);
    assert.deepEqual(files, ['package.json', 'src/App.tsx']);
    assert.equal(readFileSync(join(dest, 'src', 'App.tsx'), 'utf8'), 'app');
    assert.ok(!existsSync(join(dest, 'node_modules')));
    await assert.rejects(extractTemplate(zip, 'nope', dest));
  });

  it('builds codeload urls for branches, tags and shas', () => {
    assert.equal(archiveUrl('master'), 'https://codeload.github.com/chanhyokpark/RoomKit/zip/refs/heads/master');
    assert.equal(archiveUrl('refs/tags/v1'), 'https://codeload.github.com/chanhyokpark/RoomKit/zip/refs/tags/v1');
    assert.equal(archiveUrl('8a73932'), 'https://codeload.github.com/chanhyokpark/RoomKit/zip/8a73932');
  });
});
