import { z } from 'zod';
import { PresignUploadResponseSchema } from '@roomkit/shared';
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
