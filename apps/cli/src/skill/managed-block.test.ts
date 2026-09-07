import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readBlockVersion, removeManagedBlock, upsertManagedBlock } from './managed-block.js';

describe('managed block', () => {
  it('appends to existing content and creates when empty', () => {
    const empty = upsertManagedBlock('', 'hello', '1.0.0');
    assert.match(empty, /^<!-- roomkit-skill:start version=1.0.0 -->\nhello\n<!-- roomkit-skill:end -->\n$/);
    const appended = upsertManagedBlock('# Mine\n\nkeep me\n', 'hello', '1.0.0');
    assert.ok(appended.startsWith('# Mine\n\nkeep me\n\n<!-- roomkit-skill:start'));
    assert.equal(readBlockVersion(appended), '1.0.0');
  });

  it('replaces in place, idempotently, keeping surrounding text', () => {
    const v1 = upsertManagedBlock('before\n', 'one', '1.0.0') + '\nafter\n';
    const v2 = upsertManagedBlock(v1, 'two', '2.0.0');
    assert.equal(upsertManagedBlock(v2, 'two', '2.0.0'), v2);
    assert.ok(v2.startsWith('before\n'));
    assert.ok(v2.endsWith('after\n'));
    assert.ok(!v2.includes('one'));
    assert.equal(readBlockVersion(v2), '2.0.0');
  });

  it('removes the block and leaves the rest', () => {
    const withBlock = upsertManagedBlock('# Title\n', 'body', '1.0.0');
    assert.equal(removeManagedBlock(withBlock), '# Title\n');
    assert.equal(removeManagedBlock(upsertManagedBlock('', 'body', '1.0.0')), '');
    assert.equal(readBlockVersion('nothing'), null);
  });
});
