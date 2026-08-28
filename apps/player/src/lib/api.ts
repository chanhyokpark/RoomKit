import { auth } from './stores/auth.svelte';
import { config } from './stores/config.svelte';

/** Error thrown for non-2xx API responses. `body` is the parsed NestJS payload. */
export class ApiError extends Error {
	constructor(
		public status: number,
		public body: unknown
	) {
		super(extractMessage(body) ?? `요청이 실패했습니다 (${status})`);
		this.name = 'ApiError';
	}
}

function extractMessage(body: unknown): string | null {
	if (body && typeof body === 'object' && 'message' in body) {
		const message = (body as { message: unknown }).message;
		if (typeof message === 'string') return message;
		if (Array.isArray(message) && message.every((m) => typeof m === 'string')) {
			return message.join(', ');
		}
	}
	return null;
}

export interface ApiOptions {
	method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
	body?: unknown;
	query?: Record<string, string | undefined>;
}

/**
 * Authenticated REST call against the configured server. A 401 triggers one
 * silent re-login with the stored admin credentials (the JWT expires after
 * 12h) before failing.
 */
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
	const res = await request(path, opts);
	if (res.status === 401 && path !== '/auth/login' && (await auth.relogin())) {
		return finish<T>(await request(path, opts));
	}
	return finish<T>(res);
}

async function request(path: string, opts: ApiOptions): Promise<Response> {
	const serverUrl = config.serverUrl.trim().replace(/\/$/, '');
	const url = new URL(`${serverUrl}/api${path}`);
	for (const [key, value] of Object.entries(opts.query ?? {})) {
		if (value !== undefined) url.searchParams.set(key, value);
	}
	const headers: Record<string, string> = {};
	if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
	if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;
	return fetch(url, {
		method: opts.method ?? 'GET',
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
		// API responses are live state — bypass the HTTP cache entirely.
		cache: 'no-store'
	});
}

async function finish<T>(res: Response): Promise<T> {
	if (!res.ok) throw new ApiError(res.status, await parseJsonSafe(res));
	if (res.status === 204) return undefined as T;
	return (await parseJsonSafe(res)) as T;
}

async function parseJsonSafe(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		return null;
	}
}
