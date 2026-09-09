import type { AssetKind, PlayChannel } from '@roomkit/shared';

export const kindLabels: Record<AssetKind, string> = {
	device: '디바이스',
	bgm: 'BGM',
	dialogue: '대사',
	sfx: '효과음',
	video: '비디오',
	image: '이미지',
	file: '파일',
	hint: '힌트',
	player: '플레이어',
	website: '웹사이트',
	message: '메시지',
	state: '상태',
	phase: '페이즈',
	event: '이벤트'
};

export const channelLabels: Record<PlayChannel, string> = {
	bgm: 'BGM',
	sfx: '효과음',
	dialogue: '대사',
	video: '비디오'
};

/** `m:ss`, or `h:mm:ss` past an hour. Negative input clamps to zero. */
export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
	return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Wall-clock time of an epoch (24h, ko-KR). */
export function formatClock(epochMs: number): string {
	return new Date(epochMs).toLocaleTimeString('ko-KR', { hour12: false });
}

/** Subtitle/hint HTML → plain text for one-line previews. */
export function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, ' ')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

const UUID_SPLIT = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** Splits text so every UUID becomes its own `{ uuid: true }` token. */
export function splitUuids(text: string): Array<{ text: string; uuid: boolean }> {
	return text
		.split(UUID_SPLIT)
		.map((part, index) => ({ text: part, uuid: index % 2 === 1 }))
		.filter((token) => token.text !== '');
}
