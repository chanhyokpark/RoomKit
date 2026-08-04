import type { Asset, AssetKind, Command, WebsiteRequestMethod } from '@roomkit/shared';
import type { OperationData } from './operation-data.svelte';

/**
 * Mini command language for the operation log panel. Parses one input line
 * into either local output (help / list …) or a `Command` — the same shape
 * the sequence editor authors — to POST to the session's command endpoint.
 * Asset references are entered by name (or id) and resolved locally.
 */

/** User-facing parse/lookup failure; the message is printed to the console. */
export class ConsoleError extends Error {}

export interface ConsoleResult {
	/** Lines to print locally. */
	output: string[];
	/** Resolved command to run on the session, if the input was one. */
	command?: Command;
}

const HELP: string[] = [
	'로컬 명령:',
	'  help — 이 도움말',
	'  list devices|players|events|phases|hints|bgm|sfx|video|dialogues|websites|messages|assets',
	'세션 명령 (애셋은 이름 또는 id로 지정, 공백이 있으면 "따옴표" 사용):',
	'  playBgm <bgm> [<player>] [once] [wait] — once = 반복 없음',
	'  playSfx <sfx> [<player>] [wait]',
	'  playVideo <video> [<player>] [wait]',
	'  playDialogue <dialogue> [<player>] [wait]',
	'  stopBgm|stopSfx|stopVideo|stopDialogue [<player>|all] — 생략 시 전체 정지',
	'  navigate <device> <website> [key=value ...]',
	'  sendMessage <device> <message> [{"key":"value"}]',
	'  sendWebsiteRequest <website> <method> <path> [wait] [body=<text>] [header=Name:Value ...]',
	'  resetDevice <device> · resetAllDevices',
	'  showHintCode <hint> <device> · hideHintCode [<device>|all]',
	'  switchPhase <phase> · callEvent <event> [wait]',
	'  wait <시간> — 예: 1.5s, 500ms, 1m',
	'  adjustTimer +30s|-1m|pause|resume',
	'  endTheme success|fail',
	'  notify <메시지> · eval <코드>',
	'※ 플레이어 생략 시 테마에 플레이어가 하나면 자동 선택됩니다.'
];

const LIST_KINDS: Record<string, AssetKind | 'assets'> = {
	devices: 'device',
	device: 'device',
	players: 'player',
	player: 'player',
	events: 'event',
	event: 'event',
	phases: 'phase',
	phase: 'phase',
	hints: 'hint',
	hint: 'hint',
	bgm: 'bgm',
	sfx: 'sfx',
	video: 'video',
	videos: 'video',
	dialogues: 'dialogue',
	dialogue: 'dialogue',
	websites: 'website',
	website: 'website',
	messages: 'message',
	message: 'message',
	assets: 'assets',
	all: 'assets'
};

/** Splits on whitespace; "double" and 'single' quotes group tokens. */
function tokenize(input: string): string[] {
	const tokens: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	for (const match of input.matchAll(re)) {
		tokens.push(match[1] ?? match[2] ?? match[3]);
	}
	return tokens;
}

/** `1.5s`, `500ms`, `2m`, bare number = 초. Returns ms. */
function parseDuration(token: string): number {
	const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(token);
	if (!match) throw new ConsoleError(`시간을 해석할 수 없습니다: ${token} (예: 1.5s, 500ms, 1m)`);
	const value = Number(match[1]);
	const unit = match[2] ?? 's';
	const ms = unit === 'ms' ? value : unit === 's' ? value * 1000 : value * 60_000;
	return Math.round(ms);
}

export function parseConsole(input: string, data: OperationData, sessionId: string): ConsoleResult {
	const tokens = tokenize(input);
	if (tokens.length === 0) return { output: [] };
	const [head, ...args] = tokens;
	const cmd = head.toLowerCase();
	// eval/notify take the raw remainder — quotes/spaces must survive verbatim.
	const rest = input.slice(input.indexOf(head) + head.length).trim();

	switch (cmd) {
		case 'help':
			return { output: HELP };
		case 'list':
			return { output: list(args[0], data, sessionId) };
		case 'playbgm': {
			const flags = takeFlags(args, ['once', 'loop', 'wait']);
			return command(playCommand(data, args, 'bgm', flags));
		}
		case 'playsfx': {
			const flags = takeFlags(args, ['wait']);
			return command(playCommand(data, args, 'sfx', flags));
		}
		case 'playvideo': {
			const flags = takeFlags(args, ['wait']);
			return command(playCommand(data, args, 'video', flags));
		}
		case 'playdialogue': {
			const flags = takeFlags(args, ['wait']);
			return command(playCommand(data, args, 'dialogue', flags));
		}
		case 'stopbgm':
			return command({ type: 'stopBgm', ...stopTarget(data, args) });
		case 'stopsfx':
			return command({ type: 'stopSfx', ...stopTarget(data, args) });
		case 'stopvideo':
			return command({ type: 'stopVideo', ...stopTarget(data, args) });
		case 'stopdialogue':
			return command({ type: 'stopDialogue', ...stopTarget(data, args) });
		case 'navigate': {
			const [deviceToken, websiteToken, ...pairs] = args;
			const query = pairs.map((pair) => {
				const eq = pair.indexOf('=');
				if (eq < 1) throw new ConsoleError(`key=value 형식이 아닙니다: ${pair}`);
				return { key: pair.slice(0, eq), value: pair.slice(eq + 1) };
			});
			return command({
				type: 'navigate',
				deviceId: findAsset(data, 'device', deviceToken).id,
				websiteId: findAsset(data, 'website', websiteToken).id,
				query
			});
		}
		case 'sendmessage': {
			const [deviceToken, messageToken] = args;
			const device = findAsset(data, 'device', deviceToken);
			const message = findAsset(data, 'message', messageToken);
			let values: Record<string, unknown> = {};
			const jsonStart = rest.indexOf('{');
			if (jsonStart !== -1) {
				try {
					values = JSON.parse(rest.slice(jsonStart)) as Record<string, unknown>;
				} catch {
					throw new ConsoleError('값 JSON을 해석할 수 없습니다.');
				}
			}
			return command({
				type: 'sendMessage',
				deviceId: device.id,
				messageId: message.id,
				values: values as never,
				waitUntilEnd: false
			});
		}
		case 'sendwebsiterequest': {
			const flags = takeFlags(args, ['wait']);
			const [websiteToken, methodToken, path, ...options] = args;
			const method = methodToken?.toUpperCase();
			const allowed: WebsiteRequestMethod[] = [
				'GET',
				'HEAD',
				'POST',
				'PUT',
				'PATCH',
				'DELETE',
				'OPTIONS'
			];
			if (!method || !allowed.includes(method as WebsiteRequestMethod)) {
				throw new ConsoleError(`지원하지 않는 HTTP 메서드입니다: ${methodToken ?? '(없음)'}`);
			}
			if (path === undefined) {
				throw new ConsoleError('사용법: sendWebsiteRequest <웹사이트> <메서드> <경로>');
			}
			let body = '';
			const headers: Array<{ key: string; value: string }> = [];
			for (const option of options) {
				if (option.startsWith('body=')) {
					body = option.slice('body='.length);
					continue;
				}
				if (option.startsWith('header=')) {
					const header = option.slice('header='.length);
					const colon = header.indexOf(':');
					if (colon < 1) throw new ConsoleError(`header=Name:Value 형식이 아닙니다: ${option}`);
					headers.push({ key: header.slice(0, colon), value: header.slice(colon + 1) });
					continue;
				}
				throw new ConsoleError(`알 수 없는 요청 옵션입니다: ${option}`);
			}
			return command({
				type: 'sendWebsiteRequest',
				websiteId: findAsset(data, 'website', websiteToken).id,
				path,
				method: method as WebsiteRequestMethod,
				body,
				headers,
				waitUntilEnd: flags.has('wait')
			});
		}
		case 'resetdevice':
			return command({ type: 'resetDevice', deviceId: findAsset(data, 'device', args[0]).id });
		case 'resetalldevices':
			return command({ type: 'resetAllDevices' });
		case 'showhintcode':
			return command({
				type: 'showHintCode',
				hintId: findAsset(data, 'hint', args[0]).id,
				deviceId: findAsset(data, 'device', args[1]).id
			});
		case 'hidehintcode': {
			if (args.length === 0 || args[0].toLowerCase() === 'all') {
				return command({ type: 'hideHintCode', deviceId: null, allDevices: true });
			}
			return command({
				type: 'hideHintCode',
				deviceId: findAsset(data, 'device', args[0]).id,
				allDevices: false
			});
		}
		case 'switchphase':
			return command({ type: 'switchPhase', phaseId: findAsset(data, 'phase', args[0]).id });
		case 'callevent': {
			const flags = takeFlags(args, ['wait']);
			return command({
				type: 'callEvent',
				eventId: findAsset(data, 'event', args[0]).id,
				waitUntilFinish: flags.has('wait')
			});
		}
		case 'wait': {
			if (!args[0]) throw new ConsoleError('사용법: wait <시간> (예: 1.5s)');
			const durationMs = parseDuration(args[0]);
			if (durationMs <= 0) throw new ConsoleError('시간은 0보다 커야 합니다.');
			return command({ type: 'wait', durationMs });
		}
		case 'adjusttimer': {
			const arg = args[0]?.toLowerCase();
			if (!arg) throw new ConsoleError('사용법: adjustTimer +30s|-1m|pause|resume');
			if (arg === 'pause' || arg === 'resume') {
				return command({ type: 'adjustTimer', adjustment: { action: arg } });
			}
			const sign = arg.startsWith('-') ? -1 : 1;
			const deltaMs = sign * parseDuration(arg.replace(/^[+-]/, ''));
			return command({ type: 'adjustTimer', adjustment: { deltaMs } });
		}
		case 'endtheme': {
			const verdict = args[0]?.toLowerCase();
			if (verdict !== 'success' && verdict !== 'fail') {
				throw new ConsoleError('사용법: endTheme success|fail');
			}
			return command({ type: 'endTheme', verdict });
		}
		case 'notify':
			if (!rest) throw new ConsoleError('사용법: notify <메시지>');
			return command({ type: 'notify', message: stripQuotes(rest) });
		case 'eval':
			if (!rest) throw new ConsoleError('사용법: eval <코드>');
			return command({ type: 'eval', code: rest });
		default:
			throw new ConsoleError(`알 수 없는 명령입니다: ${head} — help로 목록을 확인하세요.`);
	}
}

function command(cmd: Command): ConsoleResult {
	return { output: [], command: cmd };
}

/** Removes one matching pair of surrounding quotes (tokenizer parity). */
function stripQuotes(text: string): string {
	const match = /^"([^"]*)"$|^'([^']*)'$/.exec(text);
	return match ? (match[1] ?? match[2]) : text;
}

/** Pulls recognized trailing flags out of `args` (mutates), case-insensitive. */
function takeFlags(args: string[], known: string[]): Set<string> {
	const flags = new Set<string>();
	for (let i = args.length - 1; i >= 0; i--) {
		const lower = args[i].toLowerCase();
		if (known.includes(lower)) {
			flags.add(lower);
			args.splice(i, 1);
		}
	}
	return flags;
}

function playCommand(
	data: OperationData,
	args: string[],
	channel: 'bgm' | 'sfx' | 'video' | 'dialogue',
	flags: Set<string>
): Command {
	const [assetToken, playerToken] = args;
	const asset = findAsset(data, channel, assetToken);
	const playerId = resolvePlayer(data, playerToken);
	const waitUntilEnd = flags.has('wait');
	switch (channel) {
		case 'bgm':
			return { type: 'playBgm', bgmId: asset.id, playerId, loop: !flags.has('once'), waitUntilEnd };
		case 'sfx':
			return { type: 'playSfx', sfxId: asset.id, playerId, waitUntilEnd };
		case 'video':
			return { type: 'playVideo', videoId: asset.id, playerId, waitUntilEnd };
		case 'dialogue':
			return {
				type: 'playDialogue',
				dialogueId: asset.id,
				playerId,
				waitUntilEnd,
				lineCues: []
			};
	}
}

/** stop* target: omitted or `all` = every player, otherwise one by name. */
function stopTarget(
	data: OperationData,
	args: string[]
): { playerId: string | null; allPlayers: boolean } {
	if (args.length === 0 || args[0].toLowerCase() === 'all') {
		return { playerId: null, allPlayers: true };
	}
	return { playerId: findAsset(data, 'player', args[0]).id, allPlayers: false };
}

/** Omitted player: auto-pick when the theme has exactly one. */
function resolvePlayer(data: OperationData, token: string | undefined): string {
	if (token !== undefined) return findAsset(data, 'player', token).id;
	const players = data.assets.filter((a) => a.kind === 'player');
	if (players.length === 1) return players[0].id;
	if (players.length === 0) throw new ConsoleError('테마에 플레이어 애셋이 없습니다.');
	throw new ConsoleError(`플레이어를 지정하세요: ${players.map((p) => p.name).join(', ')}`);
}

/** Resolves an asset token (id, exact name, or unique partial name) of a kind. */
function findAsset(data: OperationData, kind: AssetKind, token: string | undefined): Asset {
	const label = kindLabel(kind);
	if (!token) throw new ConsoleError(`${label} 이름을 입력하세요.`);
	const pool = data.assets.filter((a) => a.kind === kind);
	const byId = pool.find((a) => a.id === token);
	if (byId) return byId;
	const exact = pool.filter((a) => a.name === token);
	if (exact.length === 1) return exact[0];
	const ciExact = pool.filter((a) => a.name.toLowerCase() === token.toLowerCase());
	if (ciExact.length === 1) return ciExact[0];
	const partial = pool.filter((a) => a.name.toLowerCase().includes(token.toLowerCase()));
	if (partial.length === 1) return partial[0];
	if (partial.length > 1) {
		throw new ConsoleError(
			`${label} "${token}"이(가) 여러 개와 일치합니다: ${partial.map((a) => a.name).join(', ')}`
		);
	}
	throw new ConsoleError(`${label} "${token}"을(를) 찾을 수 없습니다.`);
}

function kindLabel(kind: AssetKind): string {
	const labels: Partial<Record<AssetKind, string>> = {
		device: '장치',
		player: '플레이어',
		event: '이벤트',
		phase: '페이즈',
		hint: '힌트',
		bgm: 'BGM',
		sfx: '효과음',
		video: '비디오',
		dialogue: '대사',
		website: '웹사이트',
		message: '메시지'
	};
	return labels[kind] ?? kind;
}

function list(kindToken: string | undefined, data: OperationData, sessionId: string): string[] {
	const kind = kindToken ? LIST_KINDS[kindToken.toLowerCase()] : undefined;
	if (!kind) {
		return [`사용법: list ${[...new Set(Object.values(LIST_KINDS))].join('|')}`];
	}
	const pool = kind === 'assets' ? data.assets : data.assets.filter((a) => a.kind === kind);
	if (pool.length === 0) return ['(없음)'];
	return pool.map((asset) => `  ${asset.name}${describe(asset, data, sessionId)}`);
}

/** Per-kind detail suffix for list output. */
function describe(asset: Asset, data: OperationData, sessionId: string): string {
	switch (asset.kind) {
		case 'device': {
			const online = data.isDeviceOnline(sessionId, asset.id);
			const extras = [
				asset.data.displayName && asset.data.displayName !== asset.name
					? asset.data.displayName
					: null,
				asset.data.isHintDevice ? '힌트' : null,
				online ? '온라인' : '오프라인'
			].filter(Boolean);
			return ` — ${extras.join(', ')}`;
		}
		case 'event': {
			const trigger =
				asset.data.triggerKind === 'device'
					? `트리거 ${asset.data.triggerName}`
					: asset.data.triggerKind === 'system'
						? `훅 ${asset.data.triggerName}`
						: '수동';
			const extras = [
				trigger,
				asset.data.manualTriggerable ? '수동 실행 가능' : null,
				asset.data.phaseId ? `페이즈: ${data.assetName(asset.data.phaseId) ?? '?'}` : '공통'
			].filter(Boolean);
			return ` — ${extras.join(', ')}`;
		}
		case 'phase':
			return ` — 순서 ${asset.data.order}`;
		case 'hint':
			return ` — ${asset.code ? `코드 ${asset.code}, ` : ''}${asset.data.steps.length}단계`;
		case 'dialogue':
			return ` — ${asset.data.lines.length}줄`;
		case 'website':
			return asset.data.mode === 'external' ? ` — ${asset.data.url}` : ' — 호스팅';
		default:
			return ` (${kindLabel(asset.kind)})`;
	}
}
