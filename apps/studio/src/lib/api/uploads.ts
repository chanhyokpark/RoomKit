import { z } from 'zod';
import {
	BulkUploadResultSchema,
	PresignUploadResponseSchema,
	SiteUploadResponseSchema,
	type BulkUploadKind,
	type BulkUploadResult,
	type SiteUploadResponse
} from '@roomkit/shared';
import { PUBLIC_API_URL } from '$env/static/public';
import { auth } from '$lib/stores/auth.svelte';
import { api } from './client';

/**
 * Presign + PUT the file directly to S3/MinIO. Returns the storage key to
 * persist in asset data. Uses XHR because fetch has no upload progress.
 */
export async function uploadFile(
	themeId: string,
	file: File,
	onProgress?: (percent: number) => void
): Promise<string> {
	// Content-Type must exactly match what gets signed.
	const contentType = file.type || 'application/octet-stream';
	const { key, url } = await api(`/themes/${themeId}/uploads`, {
		method: 'POST',
		body: { filename: file.name, contentType },
		schema: PresignUploadResponseSchema
	});

	await new Promise<void>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('PUT', url);
		xhr.setRequestHeader('Content-Type', contentType);
		xhr.upload.addEventListener('progress', (event) => {
			if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
		});
		xhr.addEventListener('load', () => {
			if (xhr.status >= 200 && xhr.status < 300) resolve();
			else reject(new Error(`업로드 실패 (${xhr.status})`));
		});
		xhr.addEventListener('error', () =>
			reject(new Error('업로드 중 네트워크 오류가 발생했습니다.'))
		);
		xhr.send(file);
	});

	return key;
}

/** Presigned GET URLs expire (600s) — fetch a fresh one every time, never cache. */
export async function getFileUrl(key: string): Promise<string> {
	const { url } = await api('/files/url', {
		query: { key },
		schema: z.object({ url: z.string() })
	});
	return url;
}

/**
 * Uploads a zip for server-side extraction (bulk media import or hosted site).
 * Unlike single files, zips go through the server, not a presigned PUT. XHR
 * for upload progress; the server-side extraction time shows no progress.
 */
async function uploadZip<T>(
	themeId: string,
	target: BulkUploadKind | 'site',
	file: File,
	schema: z.ZodType<T>,
	onProgress?: (percent: number) => void
): Promise<T> {
	const body = await new Promise<unknown>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('POST', `${PUBLIC_API_URL}/api/themes/${themeId}/imports/${target}`);
		if (auth.token) xhr.setRequestHeader('Authorization', `Bearer ${auth.token}`);
		xhr.responseType = 'json';
		xhr.upload.addEventListener('progress', (event) => {
			if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
		});
		xhr.addEventListener('load', () => {
			if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
			else {
				const message =
					xhr.response && typeof xhr.response === 'object' && 'message' in xhr.response
						? String((xhr.response as { message: unknown }).message)
						: `업로드 실패 (${xhr.status})`;
				reject(new Error(message));
			}
		});
		xhr.addEventListener('error', () =>
			reject(new Error('업로드 중 네트워크 오류가 발생했습니다.'))
		);
		const form = new FormData();
		form.append('file', file);
		xhr.send(form);
	});
	return schema.parse(body);
}

/** Bulk media import: one asset per file, dialogues grouped by `name_N` suffix. */
export function uploadMediaZip(
	themeId: string,
	kind: BulkUploadKind,
	file: File,
	onProgress?: (percent: number) => void
): Promise<BulkUploadResult> {
	return uploadZip(themeId, kind, file, BulkUploadResultSchema, onProgress);
}

/** Hosted site upload; persist the returned sitePrefix in the website asset. */
export function uploadSiteZip(
	themeId: string,
	file: File,
	onProgress?: (percent: number) => void
): Promise<SiteUploadResponse> {
	return uploadZip(themeId, 'site', file, SiteUploadResponseSchema, onProgress);
}
