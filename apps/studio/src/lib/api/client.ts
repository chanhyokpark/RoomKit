import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { PUBLIC_API_URL } from '$env/static/public';
import { toast } from 'svelte-sonner';
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

async function request<T>(
	path: string,
	opts: ApiOptions<T>,
	extraHeaders: Record<string, string> = {}
): Promise<Response> {
	const url = new URL(`${PUBLIC_API_URL}/api${path}`);
	for (const [key, value] of Object.entries(opts.query ?? {})) {
		if (value !== undefined) url.searchParams.set(key, value);
	}

	const headers: Record<string, string> = { ...extraHeaders };
	if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
	if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`;

	const res = await fetch(url, {
		method: opts.method ?? 'GET',
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
		// API responses are live state — bypass the HTTP cache entirely.
		cache: 'no-store'
	});

	if (res.status === 401 && path !== '/auth/login') {
		auth.logout();
		void goto(resolve('/login'));
		throw new ApiError(res.status, await parseJsonSafe(res));
	}
	if (!res.ok && res.status !== 304) throw new ApiError(res.status, await parseJsonSafe(res));
	return res;
}

export async function api<T = unknown>(path: string, opts: ApiOptions<T> = {}): Promise<T> {
	const res = await request(path, opts);
	if (res.status === 204) return undefined as T;

	const json = await parseJsonSafe(res);
	return opts.schema ? opts.schema.parse(json) : (json as T);
}

/** Response bodies kept for `apiRevalidated`, by URL; oldest entries drop first. */
const revalidationCache = new Map<string, { etag: string; body: string }>();
const REVALIDATION_CACHE_LIMIT = 30;

/**
 * GET for heavy, rarely-changing lists whose endpoint sends an ETag: the last
 * body is kept in memory and sent back as `If-None-Match`, so an unchanged
 * list costs a bodiless 304 instead of a full download. Never serves without
 * asking the server, and every call parses a fresh copy of the body.
 */
export async function apiRevalidated<T = unknown>(
	path: string,
	opts: Pick<ApiOptions<T>, 'query' | 'schema'> = {}
): Promise<T> {
	const key = `${path}?${new URLSearchParams(
		Object.entries(opts.query ?? {}).filter((entry): entry is [string, string] => !!entry[1])
	)}`;
	const cached = revalidationCache.get(key);
	const res = await request(path, opts, cached ? { 'If-None-Match': cached.etag } : {});

	let body: string;
	if (res.status === 304 && cached) {
		body = cached.body;
	} else {
		body = await res.text();
		const etag = res.headers.get('ETag');
		revalidationCache.delete(key);
		if (etag) {
			revalidationCache.set(key, { etag, body });
			if (revalidationCache.size > REVALIDATION_CACHE_LIMIT) {
				revalidationCache.delete(revalidationCache.keys().next().value!);
			}
		}
	}
	const json: unknown = JSON.parse(body);
	return opts.schema ? opts.schema.parse(json) : (json as T);
}

async function parseJsonSafe(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		return null;
	}
}

/**
 * Standard error toast for API failures: surfaces the server's message
 * (ApiError extracts it) instead of swallowing it behind a generic string.
 */
export function toastApiError(error: unknown, fallback: string): void {
	toast.error(error instanceof Error && error.message ? error.message : fallback);
}
