import { z } from 'zod';
import {
	ThemeSchema,
	type CreateThemeInput,
	type DuplicateThemeInput,
	type Theme,
	type UpdateThemeInput
} from '@roomkit/shared';
import { PUBLIC_API_URL } from '$env/static/public';
import { auth } from '$lib/stores/auth.svelte';
import { api, ApiError } from './client';

export function listThemes(): Promise<Theme[]> {
	return api('/themes', { schema: z.array(ThemeSchema) });
}

export function createTheme(input: CreateThemeInput): Promise<Theme> {
	return api('/themes', { method: 'POST', body: input, schema: ThemeSchema });
}

export function updateTheme(id: string, input: UpdateThemeInput): Promise<Theme> {
	return api(`/themes/${id}`, { method: 'PATCH', body: input, schema: ThemeSchema });
}

export function deleteTheme(id: string): Promise<void> {
	return api(`/themes/${id}`, { method: 'DELETE' });
}

/** Deep copy: all assets/tags with cross-references remapped, fileKeys shared. */
export function duplicateTheme(id: string, input: DuplicateThemeInput = {}): Promise<Theme> {
	return api(`/themes/${id}/duplicate`, { method: 'POST', body: input, schema: ThemeSchema });
}

/**
 * Downloads the theme's portable archive (manifest + all referenced files)
 * and hands it to the browser as a file save. Plain fetch (not `api`): the
 * response is a zip stream, not JSON.
 */
export async function downloadThemeExport(id: string): Promise<void> {
	const res = await fetch(`${PUBLIC_API_URL}/api/themes/${id}/export`, {
		headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
		cache: 'no-store'
	});
	if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));

	const match = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('Content-Disposition') ?? '');
	const filename = match ? decodeURIComponent(match[1]) : 'theme.zip';

	const url = URL.createObjectURL(await res.blob());
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

/**
 * Uploads an export archive; the server recreates the theme with fresh
 * ids/file keys. XHR for upload progress; server-side extraction shows none.
 */
export function importTheme(file: File, onProgress?: (percent: number) => void): Promise<Theme> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', `${PUBLIC_API_URL}/api/themes/import`);
		if (auth.token) xhr.setRequestHeader('Authorization', `Bearer ${auth.token}`);
		xhr.responseType = 'json';
		xhr.upload.addEventListener('progress', (event) => {
			if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
		});
		xhr.addEventListener('load', () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					resolve(ThemeSchema.parse(xhr.response));
				} catch (err) {
					reject(err instanceof Error ? err : new Error(String(err)));
				}
			} else {
				reject(new ApiError(xhr.status, xhr.response));
			}
		});
		xhr.addEventListener('error', () =>
			reject(new Error('업로드 중 네트워크 오류가 발생했습니다.'))
		);
		const form = new FormData();
		form.append('file', file);
		xhr.send(form);
	});
}
