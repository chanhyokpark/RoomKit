import type { Asset } from '@roomkit/shared';
import { triggerNameLabel } from '$lib/system-triggers';

/** Name shown in UIs: the display name when set (device/message), the name otherwise. */
export function assetDisplayName(asset: Asset): string {
	if (asset.kind === 'device' || asset.kind === 'message')
		return asset.data.displayName.trim() || asset.name;
	return asset.name;
}

/** One-line kind-specific summary shown in lists. */
export function summarizeAsset(asset: Asset): string {
	switch (asset.kind) {
		case 'device':
			// Titles show the display name, so surface the internal name here.
			return [asset.data.displayName.trim() && `이름 ${asset.name}`, `코드 ${asset.code}`]
				.filter(Boolean)
				.join(' · ');
		case 'bgm':
		case 'sfx':
		case 'video':
			return asset.data.fileKey === null
				? `플레이스홀더 · ${asset.data.durationMs / 1000}s`
				: (asset.data.fileKey.split('/').at(-1) ?? '');
		case 'dialogue': {
			const placeholderCount = asset.data.lines.filter((line) => line.fileKey === null).length;
			return [
				`${asset.data.lines.length}개 라인`,
				placeholderCount > 0 && `플레이스홀더 라인 ${placeholderCount}개`
			]
				.filter(Boolean)
				.join(' · ');
		}
		case 'hint':
			return `${asset.data.steps.length}단계`;
		case 'player':
			return asset.data.subtitleCss ? '자막 CSS 있음' : '';
		case 'website':
			return asset.data.mode === 'hosted' ? '호스팅 사이트' : asset.data.url;
		case 'message':
			return [
				asset.data.displayName.trim() && `이름 ${asset.name}`,
				`필드 ${asset.data.fields.length}개`
			]
				.filter(Boolean)
				.join(' · ');
		case 'phase':
			return `순서 ${asset.data.order}`;
		case 'event': {
			const trigger = { device: '장치', manual: '수동', system: '시스템' }[asset.data.triggerKind];
			const scope = asset.data.phaseId ? '' : '공통';
			return [scope, `${trigger} 트리거`, triggerNameLabel(asset.data.triggerName)]
				.filter(Boolean)
				.join(' · ');
		}
	}
}
