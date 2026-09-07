import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchLatestVersion } from './check.js';

const fakeFetch = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('update check', () => {
  it('reads the version from apps/cli/package.json on master', async () => {
    assert.equal(await fetchLatestVersion(fakeFetch({ version: '9.9.9' })), '9.9.9');
  });

  it('fails on HTTP errors and malformed manifests', async () => {
    await assert.rejects(fetchLatestVersion(fakeFetch({}, 500)));
    await assert.rejects(fetchLatestVersion(fakeFetch({ name: 'x' })));
  });
});
