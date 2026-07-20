import { z } from 'zod';
import {
	ThemeSchema,
	type CreateThemeInput,
	type Theme,
	type UpdateThemeInput
} from '@roomkit/shared';
import { api } from './client';

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
