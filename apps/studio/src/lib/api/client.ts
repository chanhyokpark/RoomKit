import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { PUBLIC_API_URL } from '$env/static/public';
import type { ZodType } from 'zod';
import { auth } from '$lib/stores/auth.svelte';

/** Error thrown for non-2xx API responses. `body` is the parsed NestJS error payload. */
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

export interface ApiOptions<T> {
	method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
	body?: unknown;
	query?: Record<string, string | undefined>;
	/** When given, the response JSON is validated/coerced through this schema. */
	schema?: ZodType<T>;
}

export async function api<T = unknown>(path: string, opts: ApiOptions<T> = {}): Promise<T> {
	const url = new URL(`${PUBLIC_API_URL}/api${path}`);
	for (const [key, value] of Object.entries(opts.query ?? {})) {
		if (value !== undefined) url.searchParams.set(key, value);
	}

	const headers: Record<string, string> = {};
	if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
	if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;

	const res = await fetch(url, {
		method: opts.method ?? 'GET',
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
	});

	if (res.status === 401 && path !== '/auth/login') {
		auth.logout();
		void goto(resolve('/login'));
		throw new ApiError(res.status, await parseJsonSafe(res));
	}
	if (!res.ok) throw new ApiError(res.status, await parseJsonSafe(res));
	if (res.status === 204) return undefined as T;

	const json = await parseJsonSafe(res);
	return opts.schema ? opts.schema.parse(json) : (json as T);
}

async function parseJsonSafe(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		return null;
	}
}
