import { z } from 'zod';
import { TagSchema, type CreateTagInput, type Tag, type UpdateTagInput } from '@roomkit/shared';
import { api } from './client';

export function listTags(themeId: string): Promise<Tag[]> {
	return api(`/themes/${themeId}/tags`, { schema: z.array(TagSchema) });
}

export function createTag(themeId: string, input: CreateTagInput): Promise<Tag> {
	return api(`/themes/${themeId}/tags`, { method: 'POST', body: input, schema: TagSchema });
}

export function updateTag(themeId: string, tagId: string, input: UpdateTagInput): Promise<Tag> {
	return api(`/themes/${themeId}/tags/${tagId}`, {
		method: 'PATCH',
		body: input,
		schema: TagSchema
	});
}

export function deleteTag(themeId: string, tagId: string): Promise<void> {
	return api(`/themes/${themeId}/tags/${tagId}`, { method: 'DELETE' });
}
