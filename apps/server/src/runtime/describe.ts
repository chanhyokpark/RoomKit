import type { Command, JsonValue, WireCommand } from '@roomkit/shared';

/**
 * Human-readable session-log text for commands and wires. The engine keeps a
 * name cache of the theme's assets; anything it cannot name falls back to a
 * shortened id so a log line never goes blank.
 */
export type NameLookup = (id: string | null | undefined) => string;

const PAYLOAD_LIMIT = 160;

function quote(text: string): string {
  return `"${text}"`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}s`;
}

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Compact JSON for log messages; long payloads are cut with an ellipsis. */
export function compactJson(value: unknown): string {
  const text = JSON.stringify(value) ?? 'null';
  return text.length > PAYLOAD_LIMIT
    ? `${text.slice(0, PAYLOAD_LIMIT - 1)}…`
    : text;
}

function withPayload(head: string, payload: Record<string, JsonValue>): string {
  return Object.keys(payload).length === 0
    ? head
    : `${head} ${compactJson(payload)}`;
}

function queryText(query: Array<{ key: string; value: string }>): string {
  return query.length === 0
    ? ''
    : ` ?${query.map((pair) => `${pair.key}=${pair.value}`).join('&')}`;
}

function playerTarget(
  name: NameLookup,
  playerId: string | null,
  allPlayers: boolean,
): string {
  return allPlayers || playerId === null
    ? 'all players'
    : `player ${quote(name(playerId))}`;
}

function deviceTarget(
  name: NameLookup,
  deviceId: string | null,
  allDevices: boolean,
): string {
  return allDevices || deviceId === null
    ? 'all devices'
    : `device ${quote(name(deviceId))}`;
}

/**
 * Authoring command → one line, e.g.
 * `playBgm "Intro" on player "Main" (loop)`.
 */
export function describeCommand(cmd: Command, name: NameLookup): string {
  switch (cmd.type) {
    case 'playBgm':
      return `playBgm ${quote(name(cmd.bgmId))} on player ${quote(name(cmd.playerId))}${
        cmd.loop ? ' (loop)' : cmd.waitUntilEnd ? ' (wait)' : ''
      }`;
    case 'playSfx':
      return `playSfx ${quote(name(cmd.sfxId))} on player ${quote(name(cmd.playerId))}${
        cmd.waitUntilEnd ? ' (wait)' : ''
      }`;
    case 'playVideo':
      return `playVideo ${quote(name(cmd.videoId))} on player ${quote(name(cmd.playerId))}${
        cmd.waitUntilEnd ? ' (wait)' : ''
      }`;
    case 'playDialogue':
      return `playDialogue ${quote(name(cmd.dialogueId))} on player ${quote(name(cmd.playerId))}${
        cmd.waitUntilEnd ? ' (wait)' : ''
      }${cmd.lineCues.length > 0 ? ` with ${cmd.lineCues.length} line cue(s)` : ''}`;
    case 'stopBgm':
    case 'stopSfx':
    case 'stopVideo':
    case 'stopDialogue':
      return `${cmd.type} on ${playerTarget(name, cmd.playerId, cmd.allPlayers)}`;
    case 'adjustBgmVolume':
      return `adjustBgmVolume ${cmd.value}% on player ${quote(name(cmd.playerId))}${
        cmd.durationMs > 0 ? ` over ${seconds(cmd.durationMs)}` : ''
      }`;
    case 'navigate':
      return `navigate device ${quote(name(cmd.deviceId))} to website ${quote(
        name(cmd.websiteId),
      )}${queryText(cmd.query)}`;
    case 'sendMessage':
      return withPayload(
        `sendMessage ${quote(name(cmd.messageId))} to device ${quote(name(cmd.deviceId))}${
          cmd.waitUntilEnd ? ' (wait)' : ''
        }`,
        cmd.values,
      );
    case 'setState':
      return withPayload(
        `setState ${quote(name(cmd.stateId))} on device ${quote(name(cmd.deviceId))}`,
        cmd.values,
      );
    case 'clearState':
      return `clearState on ${deviceTarget(name, cmd.deviceId, cmd.allDevices)}`;
    case 'resetDevice':
      return `resetDevice ${quote(name(cmd.deviceId))}`;
    case 'resetAllDevices':
      return 'resetAllDevices';
    case 'sendWebsiteRequest':
      return `sendWebsiteRequest ${cmd.method} ${quote(name(cmd.websiteId))}${cmd.path}${
        cmd.waitUntilEnd ? ' (wait)' : ''
      }`;
    case 'wait':
      return `wait ${seconds(cmd.durationMs)}`;
    case 'switchPhase':
      return `switchPhase to ${quote(name(cmd.phaseId))}`;
    case 'callEvent':
      return `callEvent ${quote(name(cmd.eventId))}${cmd.waitUntilFinish ? ' (wait)' : ''}`;
    case 'endTheme':
      return `endTheme (${cmd.verdict})`;
    case 'adjustTimer':
      return 'deltaMs' in cmd.adjustment
        ? `adjustTimer ${cmd.adjustment.deltaMs >= 0 ? '+' : '-'}${seconds(
            Math.abs(cmd.adjustment.deltaMs),
          )}`
        : `adjustTimer ${cmd.adjustment.action}`;
    case 'eval':
      return 'eval script';
    case 'notify':
      return `notify ${quote(cmd.message)}`;
    case 'showHintCode':
      return `showHintCode ${quote(name(cmd.hintId))} on device ${quote(name(cmd.deviceId))}`;
    case 'hideHintCode':
      return `hideHintCode on ${deviceTarget(name, cmd.deviceId, cmd.allDevices)}`;
  }
}

/**
 * Wire command → what the device is being told, e.g.
 * `Play BGM "Intro" (loop, fade in 2s)` or `Navigate to website "Lobby"`.
 */
export function describeWire(wire: WireCommand, name: NameLookup): string {
  switch (wire.type) {
    case 'play': {
      const placeholder =
        'durationMs' in wire && wire.url === null && wire.durationMs !== null
          ? `placeholder ${seconds(wire.durationMs)}`
          : null;
      switch (wire.channel) {
        case 'bgm': {
          const notes = [
            wire.loop ? 'loop' : null,
            wire.fadeInMs > 0 ? `fade in ${seconds(wire.fadeInMs)}` : null,
            wire.offsetMs !== undefined
              ? `resume at ${clock(wire.offsetMs)}`
              : null,
            placeholder,
          ].filter((note): note is string => note !== null);
          return `Play BGM ${quote(wire.assetName)}${notes.length ? ` (${notes.join(', ')})` : ''}`;
        }
        case 'sfx':
          return `Play SFX ${quote(wire.assetName)}${placeholder ? ` (${placeholder})` : ''}`;
        case 'dialogue':
          return `Play dialogue ${quote(wire.assetName)} (${wire.role}, ${wire.lines.length} line(s))`;
        case 'video': {
          const notes = [
            wire.frame ? 'framed' : 'fullscreen',
            wire.offsetMs !== undefined
              ? `resume at ${clock(wire.offsetMs)}`
              : null,
            placeholder,
          ].filter((note): note is string => note !== null);
          return `Play video ${quote(wire.assetName)} (${notes.join(', ')})`;
        }
      }
      break;
    }
    case 'stop':
      return `Stop ${wire.channel === 'bgm' ? 'BGM' : wire.channel === 'sfx' ? 'SFX' : wire.channel} (${
        wire.playerId === null
          ? 'all players'
          : `player ${quote(name(wire.playerId))}`
      })`;
    case 'bgmVolume':
      return `BGM volume ${Math.round(wire.value * 100)}% (player ${quote(name(wire.playerId))}${
        wire.durationMs > 0 ? `, over ${seconds(wire.durationMs)}` : ''
      })`;
    case 'navigate':
      return wire.url === null
        ? 'Unload website'
        : `Navigate to website ${quote(
            wire.websiteId ? name(wire.websiteId) : wire.url,
          )}${wire.force ? ' (reload)' : ''}`;
    case 'reset':
      return 'Reset device';
    case 'hintCode':
      return wire.code === null
        ? 'Hide hint code'
        : `Show hint code ${quote(wire.code)}`;
    case 'message':
      return withPayload(`Message ${quote(wire.messageName)}`, wire.payload);
    case 'state':
      return wire.state === null
        ? 'Clear state'
        : withPayload(
            `State ${quote(wire.state.stateName)}`,
            wire.state.payload,
          );
    case 'testCallback':
      return `Test callback ${quote(wire.name)}`;
  }
  // Unreachable: every play channel returned above (TS narrows to never).
  return (wire as { type: string }).type;
}

/**
 * The wire's parameters for the log's structured `data`: everything an
 * operator may want to inspect, minus bulky/secret fields (presigned media
 * URLs, injected CSS, subtitle HTML).
 */
export function wireParams(wire: WireCommand): Record<string, JsonValue> {
  switch (wire.type) {
    case 'play': {
      const base: Record<string, JsonValue> = {
        channel: wire.channel,
        playerId: wire.playerId,
        assetId: wire.assetId,
        assetName: wire.assetName,
      };
      switch (wire.channel) {
        case 'bgm':
          return {
            ...base,
            loop: wire.loop,
            fadeInMs: wire.fadeInMs,
            fadeOutMs: wire.fadeOutMs,
            ...(wire.offsetMs !== undefined ? { offsetMs: wire.offsetMs } : {}),
            ...(wire.durationMs !== null
              ? { placeholderMs: wire.durationMs }
              : {}),
          };
        case 'sfx':
          return {
            ...base,
            ...(wire.bgmDuck !== undefined ? { bgmDuck: wire.bgmDuck } : {}),
            ...(wire.durationMs !== null
              ? { placeholderMs: wire.durationMs }
              : {}),
          };
        case 'dialogue':
          return {
            ...base,
            role: wire.role,
            lines: wire.lines.length,
            keepSubtitleAfterEnd: wire.keepSubtitleAfterEnd,
            ...(Object.keys(wire.params).length > 0
              ? { params: wire.params }
              : {}),
          };
        case 'video':
          return {
            ...base,
            frame: wire.frame,
            ...(wire.offsetMs !== undefined ? { offsetMs: wire.offsetMs } : {}),
            ...(wire.durationMs !== null
              ? { placeholderMs: wire.durationMs }
              : {}),
            ...(Object.keys(wire.params).length > 0
              ? { params: wire.params }
              : {}),
          };
      }
      return base;
    }
    case 'stop':
      return { channel: wire.channel, playerId: wire.playerId };
    case 'bgmVolume':
      return {
        playerId: wire.playerId,
        value: wire.value,
        durationMs: wire.durationMs,
      };
    case 'navigate':
      return { websiteId: wire.websiteId, url: wire.url, force: wire.force };
    case 'reset':
      return {};
    case 'hintCode':
      return {
        code: wire.code,
        ...(Object.keys(wire.params).length > 0 ? { params: wire.params } : {}),
      };
    case 'message':
      return {
        messageId: wire.messageId,
        messageName: wire.messageName,
        payload: wire.payload,
      };
    case 'state':
      return wire.state === null
        ? { state: null }
        : {
            stateId: wire.state.stateId,
            stateName: wire.state.stateName,
            payload: wire.state.payload,
          };
    case 'testCallback':
      return { name: wire.name };
  }
}
