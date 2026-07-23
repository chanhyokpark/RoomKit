import type { Icon as IconType } from '@lucide/svelte';
import BellRingIcon from '@lucide/svelte/icons/bell-ring';
import CircleStopIcon from '@lucide/svelte/icons/circle-stop';
import CodeIcon from '@lucide/svelte/icons/code';
import EyeOffIcon from '@lucide/svelte/icons/eye-off';
import FilmIcon from '@lucide/svelte/icons/film';
import FlagIcon from '@lucide/svelte/icons/flag';
import GlobeIcon from '@lucide/svelte/icons/globe';
import HourglassIcon from '@lucide/svelte/icons/hourglass';
import KeyRoundIcon from '@lucide/svelte/icons/key-round';
import MessagesSquareIcon from '@lucide/svelte/icons/messages-square';
import MilestoneIcon from '@lucide/svelte/icons/milestone';
import MusicIcon from '@lucide/svelte/icons/music';
import RefreshCcwIcon from '@lucide/svelte/icons/refresh-ccw';
import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
import SendIcon from '@lucide/svelte/icons/send';
import TimerIcon from '@lucide/svelte/icons/timer';
import Volume2Icon from '@lucide/svelte/icons/volume-2';
import ZapIcon from '@lucide/svelte/icons/zap';
import type { Asset, AssetKind, Command, CommandType, Sequence } from '@roomkit/shared';

export interface CommandMeta {
	label: string;
	icon: typeof IconType;
	/** Fresh command with default params. Asset refs start unset (null). */
	create(): Command;
}

export const COMMAND_META: Record<CommandType, CommandMeta> = {
	playDialogue: {
		label: '대사 재생',
		icon: MessagesSquareIcon,
		create: () => ({ type: 'playDialogue', dialogueId: null, playerId: null, waitUntilEnd: false })
	},
	stopDialogue: {
		label: '대사 정지',
		icon: CircleStopIcon,
		create: () => ({ type: 'stopDialogue', playerId: null, allPlayers: false })
	},
	playSfx: {
		label: '효과음 재생',
		icon: Volume2Icon,
		create: () => ({ type: 'playSfx', sfxId: null, playerId: null })
	},
	stopSfx: {
		label: '효과음 정지',
		icon: CircleStopIcon,
		create: () => ({ type: 'stopSfx', playerId: null, allPlayers: false })
	},
	playVideo: {
		label: '비디오 재생',
		icon: FilmIcon,
		create: () => ({ type: 'playVideo', videoId: null, playerId: null, waitUntilEnd: false })
	},
	stopVideo: {
		label: '비디오 정지',
		icon: CircleStopIcon,
		create: () => ({ type: 'stopVideo', playerId: null, allPlayers: false })
	},
	playBgm: {
		label: 'BGM 재생',
		icon: MusicIcon,
		create: () => ({ type: 'playBgm', bgmId: null, playerId: null, loop: true })
	},
	stopBgm: {
		label: 'BGM 정지',
		icon: CircleStopIcon,
		create: () => ({ type: 'stopBgm', playerId: null, allPlayers: false })
	},
	resetDevice: {
		label: '장치 리셋',
		icon: RotateCcwIcon,
		create: () => ({ type: 'resetDevice', deviceId: null })
	},
	resetAllDevices: {
		label: '모든 장치 리셋',
		icon: RefreshCcwIcon,
		create: () => ({ type: 'resetAllDevices' })
	},
	navigate: {
		label: '웹사이트 이동',
		icon: GlobeIcon,
		create: () => ({ type: 'navigate', deviceId: null, websiteId: null })
	},
	sendMessage: {
		label: '메시지 전송',
		icon: SendIcon,
		create: () => ({ type: 'sendMessage', deviceId: null, messageId: null, values: {} })
	},
	wait: {
		label: '대기',
		icon: HourglassIcon,
		create: () => ({ type: 'wait', durationMs: 1000 })
	},
	switchPhase: {
		label: '페이즈 전환',
		icon: MilestoneIcon,
		create: () => ({ type: 'switchPhase', phaseId: null })
	},
	callEvent: {
		label: '이벤트 호출',
		icon: ZapIcon,
		create: () => ({ type: 'callEvent', eventId: null, waitUntilFinish: false })
	},
	adjustTimer: {
		label: '타이머 조정',
		icon: TimerIcon,
		create: () => ({ type: 'adjustTimer', adjustment: { deltaMs: 60_000 } })
	},
	endTheme: {
		label: '테마 종료',
		icon: FlagIcon,
		create: () => ({ type: 'endTheme', verdict: 'success' })
	},
	eval: {
		label: 'JavaScript 실행',
		icon: CodeIcon,
		create: () => ({ type: 'eval', code: '' })
	},
	notify: {
		label: '알림 보내기',
		icon: BellRingIcon,
		create: () => ({ type: 'notify', message: '' })
	},
	showHintCode: {
		label: '힌트 코드 표시',
		icon: KeyRoundIcon,
		create: () => ({ type: 'showHintCode', hintId: null, deviceId: null })
	},
	hideHintCode: {
		label: '힌트 코드 숨김',
		icon: EyeOffIcon,
		create: () => ({ type: 'hideHintCode', deviceId: null, allDevices: false })
	}
};

export interface CommandGroup {
	label: string;
	types: CommandType[];
}

export const COMMAND_GROUPS: CommandGroup[] = [
	{
		label: '재생',
		types: [
			'playDialogue',
			'playSfx',
			'playVideo',
			'playBgm',
			'stopDialogue',
			'stopSfx',
			'stopVideo',
			'stopBgm'
		]
	},
	{
		label: '장치',
		types: [
			'resetDevice',
			'resetAllDevices',
			'navigate',
			'sendMessage',
			'showHintCode',
			'hideHintCode'
		]
	},
	{ label: '흐름', types: ['wait', 'switchPhase', 'callEvent', 'eval', 'endTheme'] },
	{ label: '타이머', types: ['adjustTimer'] },
	{ label: '운영', types: ['notify'] }
];

export interface CommandRef {
	kind: AssetKind;
	id: string | null;
}

/** Asset references of a command, for pickers and integrity warnings. */
export function commandRefs(cmd: Command): CommandRef[] {
	switch (cmd.type) {
		case 'resetDevice':
			return [{ kind: 'device', id: cmd.deviceId }];
		case 'playDialogue':
			return [
				{ kind: 'dialogue', id: cmd.dialogueId },
				{ kind: 'player', id: cmd.playerId }
			];
		case 'playSfx':
			return [
				{ kind: 'sfx', id: cmd.sfxId },
				{ kind: 'player', id: cmd.playerId }
			];
		case 'playVideo':
			return [
				{ kind: 'video', id: cmd.videoId },
				{ kind: 'player', id: cmd.playerId }
			];
		case 'playBgm':
			return [
				{ kind: 'bgm', id: cmd.bgmId },
				{ kind: 'player', id: cmd.playerId }
			];
		case 'stopDialogue':
		case 'stopSfx':
		case 'stopVideo':
		case 'stopBgm':
			// "All players" needs no ref — suppress the unset-ref warning.
			return cmd.allPlayers ? [] : [{ kind: 'player', id: cmd.playerId }];
		case 'navigate':
			return [
				{ kind: 'device', id: cmd.deviceId },
				{ kind: 'website', id: cmd.websiteId }
			];
		case 'sendMessage':
			return [
				{ kind: 'device', id: cmd.deviceId },
				{ kind: 'message', id: cmd.messageId }
			];
		case 'switchPhase':
			return [{ kind: 'phase', id: cmd.phaseId }];
		case 'callEvent':
			return [{ kind: 'event', id: cmd.eventId }];
		case 'showHintCode':
			return [
				{ kind: 'hint', id: cmd.hintId },
				{ kind: 'device', id: cmd.deviceId }
			];
		case 'hideHintCode':
			return cmd.allDevices ? [] : [{ kind: 'device', id: cmd.deviceId }];
		default:
			return [];
	}
}

export interface RefIssues {
	/** A reference is still null — the command is incomplete. */
	unset: boolean;
	/** A referenced asset no longer exists (or changed kind). */
	dangling: boolean;
}

export function commandRefIssues(cmd: Command, byId: Map<string, Asset>): RefIssues {
	let unset = false;
	let dangling = false;
	for (const ref of commandRefs(cmd)) {
		if (ref.id === null) unset = true;
		else {
			const asset = byId.get(ref.id);
			if (!asset || asset.kind !== ref.kind) dangling = true;
		}
	}
	return { unset, dangling };
}

export function sequenceHasIssues(sequence: Sequence, byId: Map<string, Asset>): boolean {
	return sequence.some((entry) => {
		const issues = commandRefIssues(entry, byId);
		return issues.unset || issues.dangling;
	});
}
