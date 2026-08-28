import {
  CommandSchema,
  type Asset,
  type AssetKind,
  type Command,
} from '@roomkit/shared';

export class ConsoleError extends Error {}

export interface ConsoleResult {
  output: string[];
  command?: Command;
}

const HELP = [
  'help · list <devices|players|events|phases|hints|bgm|sfx|video|dialogues|websites|messages>',
  'playBgm|playSfx|playVideo|playDialogue <asset> [player] [wait]',
  'stopBgm|stopSfx|stopVideo|stopDialogue [player|all]',
  'adjustBgmVolume <player> <0..100>',
  'navigate <device> <website> [key=value ...] · resetDevice <device> · resetAllDevices',
  'callEvent <event> [wait] · switchPhase <phase>',
  'showHintCode <hint> <device> · hideHintCode [device|all]',
  'adjustTimer +30s|-1m|pause|resume · notify <message> · eval <code>',
  'json {"type":"..."} — 완전한 Command JSON 실행',
];

const LIST_KIND: Record<string, AssetKind> = {
  devices: 'device',
  players: 'player',
  events: 'event',
  phases: 'phase',
  hints: 'hint',
  bgm: 'bgm',
  sfx: 'sfx',
  video: 'video',
  dialogues: 'dialogue',
  websites: 'website',
  messages: 'message',
};

export function parseConsole(input: string, assets: Asset[]): ConsoleResult {
  const tokens = tokenize(input);
  if (tokens.length === 0) return { output: [] };
  const [head, ...args] = tokens;
  const commandName = head.toLowerCase();
  const rest = input.slice(input.indexOf(head) + head.length).trim();

  if (commandName === 'help') return { output: HELP };
  if (commandName === 'list') {
    const kind = LIST_KIND[args[0]?.toLowerCase()];
    if (!kind)
      throw new ConsoleError(
        '사용법: list devices|players|events|phases|hints|…',
      );
    const rows = assets.filter((asset) => asset.kind === kind);
    return {
      output:
        rows.length > 0
          ? rows.map((asset) => `${asset.name} · ${asset.id}`)
          : ['(없음)'],
    };
  }
  if (commandName === 'json') {
    try {
      return { output: [], command: CommandSchema.parse(JSON.parse(rest)) };
    } catch (error) {
      throw new ConsoleError(
        error instanceof Error
          ? error.message
          : 'Command JSON이 올바르지 않습니다.',
      );
    }
  }

  const wait = takeFlag(args, 'wait');
  const once = takeFlag(args, 'once');
  switch (commandName) {
    case 'playbgm':
      return command({
        type: 'playBgm',
        bgmId: find(assets, 'bgm', args[0]).id,
        playerId: player(assets, args[1]),
        loop: !once,
        waitUntilEnd: wait,
      });
    case 'playsfx':
      return command({
        type: 'playSfx',
        sfxId: find(assets, 'sfx', args[0]).id,
        playerId: player(assets, args[1]),
        waitUntilEnd: wait,
      });
    case 'playvideo':
      return command({
        type: 'playVideo',
        videoId: find(assets, 'video', args[0]).id,
        playerId: player(assets, args[1]),
        waitUntilEnd: wait,
      });
    case 'playdialogue':
      return command({
        type: 'playDialogue',
        dialogueId: find(assets, 'dialogue', args[0]).id,
        playerId: player(assets, args[1]),
        waitUntilEnd: wait,
        lineCues: [],
      });
    case 'stopbgm':
      return command({ type: 'stopBgm', ...stopTarget(assets, args[0]) });
    case 'adjustbgmvolume': {
      const value = Number(args[1]);
      if (!Number.isFinite(value) || value < 0 || value > 100)
        throw new ConsoleError('사용법: adjustBgmVolume <player> <0..100>');
      return command({
        type: 'adjustBgmVolume',
        playerId: player(assets, args[0]),
        value,
      });
    }
    case 'stopsfx':
      return command({ type: 'stopSfx', ...stopTarget(assets, args[0]) });
    case 'stopvideo':
      return command({ type: 'stopVideo', ...stopTarget(assets, args[0]) });
    case 'stopdialogue':
      return command({ type: 'stopDialogue', ...stopTarget(assets, args[0]) });
    case 'navigate':
      return command({
        type: 'navigate',
        deviceId: find(assets, 'device', args[0]).id,
        websiteId: find(assets, 'website', args[1]).id,
        query: args.slice(2).map((pair) => {
          const index = pair.indexOf('=');
          if (index < 1)
            throw new ConsoleError(`key=value 형식이 아닙니다: ${pair}`);
          return { key: pair.slice(0, index), value: pair.slice(index + 1) };
        }),
      });
    case 'resetdevice':
      return command({
        type: 'resetDevice',
        deviceId: find(assets, 'device', args[0]).id,
      });
    case 'resetalldevices':
      return command({ type: 'resetAllDevices' });
    case 'callevent':
      return command({
        type: 'callEvent',
        eventId: find(assets, 'event', args[0]).id,
        waitUntilFinish: wait,
      });
    case 'switchphase':
      return command({
        type: 'switchPhase',
        phaseId: find(assets, 'phase', args[0]).id,
      });
    case 'showhintcode':
      return command({
        type: 'showHintCode',
        hintId: find(assets, 'hint', args[0]).id,
        deviceId: find(assets, 'device', args[1]).id,
      });
    case 'hidehintcode':
      return args.length === 0 || args[0].toLowerCase() === 'all'
        ? command({ type: 'hideHintCode', deviceId: null, allDevices: true })
        : command({
            type: 'hideHintCode',
            deviceId: find(assets, 'device', args[0]).id,
            allDevices: false,
          });
    case 'adjusttimer': {
      const value = args[0]?.toLowerCase();
      if (value === 'pause' || value === 'resume') {
        return command({ type: 'adjustTimer', adjustment: { action: value } });
      }
      if (!value)
        throw new ConsoleError('사용법: adjustTimer +30s|-1m|pause|resume');
      const sign = value.startsWith('-') ? -1 : 1;
      return command({
        type: 'adjustTimer',
        adjustment: { deltaMs: sign * duration(value.replace(/^[+-]/, '')) },
      });
    }
    case 'notify':
      if (!rest) throw new ConsoleError('알림 메시지를 입력하세요.');
      return command({ type: 'notify', message: stripQuotes(rest) });
    case 'eval':
      if (!rest) throw new ConsoleError('실행할 코드를 입력하세요.');
      return command({ type: 'eval', code: rest });
    default:
      throw new ConsoleError(
        `알 수 없는 명령입니다: ${head} — help로 목록을 확인하세요.`,
      );
  }
}

function command(value: Command): ConsoleResult {
  return { output: [], command: value };
}

function tokenize(input: string): string[] {
  return [...input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  );
}

function takeFlag(args: string[], flag: string): boolean {
  const index = args.findIndex((value) => value.toLowerCase() === flag);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function find(
  assets: Asset[],
  kind: AssetKind,
  token: string | undefined,
): Asset {
  if (!token) throw new ConsoleError(`${kind} 이름을 입력하세요.`);
  const pool = assets.filter((asset) => asset.kind === kind);
  const exact = pool.find(
    (asset) =>
      asset.id === token || asset.name.toLowerCase() === token.toLowerCase(),
  );
  if (exact) return exact;
  const partial = pool.filter((asset) =>
    asset.name.toLowerCase().includes(token.toLowerCase()),
  );
  if (partial.length === 1) return partial[0];
  if (partial.length > 1)
    throw new ConsoleError(
      `여러 애셋이 일치합니다: ${partial.map((a) => a.name).join(', ')}`,
    );
  throw new ConsoleError(`${kind} "${token}"을 찾을 수 없습니다.`);
}

function player(assets: Asset[], token: string | undefined): string {
  if (token) return find(assets, 'player', token).id;
  const players = assets.filter((asset) => asset.kind === 'player');
  if (players.length === 1) return players[0].id;
  throw new ConsoleError('플레이어를 지정하세요.');
}

function stopTarget(
  assets: Asset[],
  token: string | undefined,
): { playerId: string | null; allPlayers: boolean } {
  return !token || token.toLowerCase() === 'all'
    ? { playerId: null, allPlayers: true }
    : { playerId: find(assets, 'player', token).id, allPlayers: false };
}

function duration(token: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(token);
  if (!match) throw new ConsoleError(`시간을 해석할 수 없습니다: ${token}`);
  const value = Number(match[1]);
  return Math.round(
    match[2] === 'ms'
      ? value
      : match[2] === 'm'
        ? value * 60_000
        : value * 1000,
  );
}

function stripQuotes(text: string): string {
  const match = /^"([^"]*)"$|^'([^']*)'$/.exec(text);
  return match ? (match[1] ?? match[2]) : text;
}
