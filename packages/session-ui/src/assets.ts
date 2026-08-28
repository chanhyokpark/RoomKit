import type { Asset, SequenceEntry } from '@roomkit/shared';

export function assetsOf<K extends Asset['kind']>(
	assets: Asset[],
	kind: K
): Extract<Asset, { kind: K }>[] {
	return assets.filter((asset): asset is Extract<Asset, { kind: K }> => asset.kind === kind);
}

export function assetName(assets: Asset[], id: string | null | undefined): string | null {
	if (!id) return null;
	return assets.find((asset) => asset.id === id)?.name ?? null;
}

export function commandLabel(entry: SequenceEntry, assets: Asset[]): string {
	const name = (id: string | null | undefined) => assetName(assets, id) ?? '(삭제됨)';
	switch (entry.type) {
		case 'playDialogue':
			return `대사 재생: ${name(entry.dialogueId)}${entry.waitUntilEnd ? ' (대기)' : ''}`;
		case 'stopDialogue':
			return `대사 정지${entry.allPlayers ? ' (전체)' : `: ${name(entry.playerId)}`}`;
		case 'playBgm':
			return `BGM 재생: ${name(entry.bgmId)}${entry.loop ? ' (반복)' : ''}`;
		case 'stopBgm':
			return `BGM 정지${entry.allPlayers ? ' (전체)' : `: ${name(entry.playerId)}`}`;
		case 'playSfx':
			return `효과음 재생: ${name(entry.sfxId)}`;
		case 'stopSfx':
			return `효과음 정지${entry.allPlayers ? ' (전체)' : `: ${name(entry.playerId)}`}`;
		case 'playVideo':
			return `비디오 재생: ${name(entry.videoId)}${entry.waitUntilEnd ? ' (대기)' : ''}`;
		case 'stopVideo':
			return `비디오 정지${entry.allPlayers ? ' (전체)' : `: ${name(entry.playerId)}`}`;
		case 'wait':
			return `대기: ${entry.durationMs / 1000}초`;
		case 'navigate':
			return `이동: ${name(entry.deviceId)} → ${name(entry.websiteId)}`;
		case 'sendMessage':
			return `메시지 전송: ${name(entry.deviceId)} ← ${name(entry.messageId)}`;
		case 'sendWebsiteRequest':
			return `웹 요청: ${entry.method} ${name(entry.websiteId)}${entry.path}`;
		case 'switchPhase':
			return `페이즈 전환: ${name(entry.phaseId)}`;
		case 'callEvent':
			return `이벤트 호출: ${name(entry.eventId)}`;
		case 'resetDevice':
			return `디바이스 리셋: ${name(entry.deviceId)}`;
		case 'resetAllDevices':
			return '디바이스 전체 리셋';
		case 'endTheme':
			return `테마 종료 (${entry.verdict === 'success' ? '성공' : '실패'})`;
		case 'adjustTimer':
			return 'deltaMs' in entry.adjustment
				? `타이머 조정: ${entry.adjustment.deltaMs / 1000}초`
				: `타이머 ${entry.adjustment.action === 'pause' ? '정지' : '재개'}`;
		case 'eval':
			return '스크립트 실행';
		case 'notify':
			return `알림: ${entry.message}`;
		case 'showHintCode':
			return `힌트 코드 표시: ${name(entry.hintId)} @ ${name(entry.deviceId)}`;
		case 'hideHintCode':
			return `힌트 코드 숨김${entry.allDevices ? ' (전체)' : `: ${name(entry.deviceId)}`}`;
	}
}
