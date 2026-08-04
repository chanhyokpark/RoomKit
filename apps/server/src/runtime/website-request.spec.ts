import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ResolvedWebsiteRequest } from './command-resolver';
import { performWebsiteRequest } from './website-request';

describe('performWebsiteRequest', () => {
  let server: Server;
  let origin: string;

  afterEach(
    () =>
      new Promise<void>((resolve, reject) => {
        if (!server?.listening) return resolve();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  it('sends method, body, and headers and waits for the response body to end', async () => {
    let received:
      | { method: string | undefined; body: string; token: string | undefined }
      | undefined;
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received = {
          method: request.method,
          body: Buffer.concat(chunks).toString(),
          token: request.headers['x-test-token'],
        };
        response.writeHead(200);
        response.write('started');
        setTimeout(() => response.end('finished'), 60);
      });
    });
    await listen(server);
    const address = server.address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;

    const request: ResolvedWebsiteRequest = {
      websiteId: 'website-id',
      websiteName: 'controller',
      url: `${origin}/action`,
      method: 'POST',
      body: '{"answer":42}',
      headers: [{ key: 'X-Test-Token', value: 'secret' }],
      waitUntilEnd: true,
    };
    const startedAt = Date.now();
    const result = await performWebsiteRequest(request);

    expect(result).toMatchObject({ status: 'done', statusCode: 200 });
    expect(received).toEqual({
      method: 'POST',
      body: '{"answer":42}',
      token: 'secret',
    });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(50);
  });

  it('reports non-success HTTP responses as failed', async () => {
    server = createServer((_request, response) => {
      response.writeHead(503, 'Unavailable');
      response.end();
    });
    await listen(server);
    const address = server.address() as AddressInfo;

    const result = await performWebsiteRequest({
      websiteId: 'website-id',
      websiteName: 'controller',
      url: `http://127.0.0.1:${address.port}/unavailable`,
      method: 'GET',
      body: 'ignored',
      headers: [],
      waitUntilEnd: false,
    });

    expect(result).toMatchObject({ status: 'failed', statusCode: 503 });
  });
});

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}
