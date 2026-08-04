import type { ResolvedWebsiteRequest } from './command-resolver';

export type WebsiteRequestResult =
  | { status: 'done' | 'failed'; statusCode: number; statusText: string }
  | { status: 'failed'; error: string };

/**
 * Sends a resolved website request and drains the response without retaining
 * it. Draining matters for waitUntilEnd: fetch() itself resolves as soon as
 * response headers arrive, while the authored switch promises to wait for the
 * complete response.
 */
export async function performWebsiteRequest(
  request: ResolvedWebsiteRequest,
  signal?: AbortSignal,
): Promise<WebsiteRequestResult> {
  try {
    const headers = new Headers();
    for (const { key, value } of request.headers) {
      if (key.trim() !== '') headers.append(key, value);
    }
    const response = await fetch(request.url, {
      method: request.method,
      headers,
      signal,
      ...(request.method === 'GET' || request.method === 'HEAD'
        ? {}
        : { body: request.body }),
    });
    if (response.body) {
      const reader = response.body.getReader();
      while (!(await reader.read()).done) {
        // Drain without buffering potentially large response bodies.
      }
    }
    return {
      status: response.ok ? 'done' : 'failed',
      statusCode: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
