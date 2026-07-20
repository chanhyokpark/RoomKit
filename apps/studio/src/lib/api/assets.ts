import { z } from 'zod';
import {
	AssetSchema,
	type Asset,
	type AssetKind,
	type CreateAssetInput,
	type UpdateAssetInput
} from '@roomkit/shared';
import { api } from './client';

export interface AssetFilters {
	kind?: AssetKind;
	tagId?: string;
}

export function listAssets(themeId: string, filters: AssetFilters = {}): Promise<Asset[]> {
	return api(`/themes/${themeId}/assets`, {
		query: { kind: filters.kind, tagId: filters.tagId },
		schema: z.array(AssetSchema)
	});
}

export function createAsset(themeId: string, input: CreateAssetInput): Promise<Asset> {
	return api(`/themes/${themeId}/assets`, { method: 'POST', body: input, schema: AssetSchema });
}

export function updateAsset(
	themeId: string,
	assetId: string,
	input: UpdateAssetInput
): Promise<Asset> {
	return api(`/themes/${themeId}/assets/${assetId}`, {
		method: 'PATCH',
		body: input,
		schema: AssetSchema
	});
}

export function deleteAsset(themeId: string, assetId: string): Promise<void> {
	return api(`/themes/${themeId}/assets/${assetId}`, { method: 'DELETE' });
}
