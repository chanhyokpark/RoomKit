import { z } from 'zod';
import {
  assetDataSchemas,
  COMMAND_ASSET_REFS,
  CreateAssetInputSchema,
  SequenceSchema,
  SystemTriggerSchema,
  type AssetKind,
} from '@roomkit/shared';

/** Shared conversion options for exposing zod schemas to the calling agent. */
export function toInputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    io: 'input',
    target: 'draft-2020-12',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
}

/**
 * Which asset kind each command ref field points at. Field names are unique
 * across commands, so a flat map is enough (used for kind-mismatch warnings).
 */
export const REF_FIELD_KINDS: Record<string, AssetKind> = {
  deviceId: 'device',
  playerId: 'player',
  dialogueId: 'dialogue',
  sfxId: 'sfx',
  videoId: 'video',
  bgmId: 'bgm',
  websiteId: 'website',
  messageId: 'message',
  stateId: 'state',
  phaseId: 'phase',
  eventId: 'event',
  hintId: 'hint',
};

export function commandsDoc(): unknown {
  return {
    notes: [
      'A sequence is an ordered JSON array of command entries; each entry is {id: <string>, type: <command>, ...params}. `id` is any string unique within its sequence (Studio uses uuids; readable ids like "open-door" are fine) and is the target for `rk sequence edit`. Omit it in `rk sequence set`/`validate`/`edit` inputs to have one generated.',
      'Asset reference fields (deviceId, playerId, bgmId, ...) hold an asset uuid or null in stored data. In rk inputs you may write a uuid, the asset `key`, its code (device/hint), or its unique name — rk resolves it to the uuid (errors on unknown/ambiguous names). Null/dangling refs are not fatal: the runtime logs and skips that command.',
      'playDialogue.lineCues wedge commands between dialogue lines: {afterLineId: <dialogue line id>, sequence: [...commands]}. playDialogue itself is not allowed inside a cue (use callEvent instead). A cue after the last line never runs.',
      'waitUntilEnd on play commands makes the sequence wait for playback to finish before the next entry. wait.durationMs pauses the sequence.',
      'adjustBgmVolume.value is a 0..100 percent base volume for one player; it persists through later BGM tracks until that device is reset, while fades and ducking still multiply it. Optional adjustBgmVolume.durationMs (default 0) ramps the playing track to the new volume over that many ms; the sequence does not wait for the ramp.',
      'switchPhase changes the session phase; callEvent runs another event (waitUntilFinish to await it); eval runs JS in a server sandbox (returning false aborts the sequence); endTheme ends the game with a success/fail verdict.',
      'sendMessage.values, setState.values, navigate query values, and sendWebsiteRequest path/body/headers support {{vars.x}} and {{payload.x}} template interpolation at run time.',
      'setState sets a device\'s durable display state (one per device; replaces the previous) — the server remembers it and replays it whenever the device (re)connects, so use it for anything a screen should keep showing. clearState returns the device to the "default" state. sendMessage is for transient effects/transitions: it is not remembered or replayed.',
      'sendWebsiteRequest sends HTTP from the RoomKit server to a URL resolved from a website asset; waitUntilEnd waits through the complete response body.',
      `Events (kind "event" assets) hold the sequence in data.sequence and are fired by their trigger: triggerKind "device" + triggerName = a device-reported event name, "manual" = fired by an operator (\`rk session trigger\`), "system" + one of ${SystemTriggerSchema.options.join('/')}.`,
    ],
    assetRefFieldsByCommandType: COMMAND_ASSET_REFS,
    refFieldAssetKinds: REF_FIELD_KINDS,
    sequenceJsonSchema: toInputJsonSchema(SequenceSchema),
  };
}

const KIND_NOTES: Record<AssetKind, string[]> = {
  device: [
    'A physical/virtual screen or prop in the room. `code` (top-level asset field, unique per theme) is what a production device registers with; test sessions generate per-session codes instead.',
    'isHintDevice marks the device running the hint code-entry UI.',
  ],
  bgm: [
    'fileKey comes from `rk upload`. fileKey null = placeholder asset: clients simulate playback for durationMs.',
    'fadeInMs/fadeOutMs control volume ramps; stopping or replacing BGM uses fadeOutMs (crossfade).',
  ],
  dialogue: [
    'lines[] play in array order; each line needs an id (uuid), fileKey (or null placeholder + durationMs), and subtitleHtml.',
    'Line ids anchor playDialogue lineCues — keep them stable when editing.',
  ],
  sfx: [
    'fileKey null = placeholder: clients simulate playback for durationMs.',
  ],
  video: [
    'frame places the video surface on the stage in percent; null = fullscreen.',
    'params is free-form JSON forwarded to the website for rendering.',
  ],
  image: [
    'Static resource for hosted websites, served publicly at /api/media/{assetId} (stable URL).',
    'fileKey null serves a generated placeholder with placeholderRatio.',
  ],
  file: [
    'Arbitrary file served publicly at /api/media/{assetId}; 404 until fileKey is set.',
  ],
  hint: [
    '`code` (top-level asset field) is the code players type on the hint device; auto-generated 4-digit when omitted on create.',
    'steps[] are revealed one by one; textHtml allows HTML.',
  ],
  player: [
    'An audio/subtitle output pairing: speakerDeviceId plays audio, screenDeviceId renders subtitles/video (may be the same device).',
    'dialogueDuckPercent/sfxDuckPercent duck BGM volume while dialogue/SFX play (null = no ducking).',
  ],
  website: [
    'mode "external" registers a URL; mode "hosted" points at an uploaded site (sitePrefix from the site zip import).',
    'Devices show websites via the navigate command.',
  ],
  message: [
    'Defines a payload shape (fields[]) the sendMessage command fills in per use; the website receives it via the client library.',
    'Messages are transient (not remembered, not replayed on reconnect) — use them for effects and transitions. For what a screen should keep showing, define a state asset and use setState.',
  ],
  state: [
    'Durable per-device display state. Same data shape as message (displayName + fields[]); values are supplied by setState commands, phase registrations, or the operation UI.',
    'One state is active per device at a time: setState replaces it, clearState clears it (the website sees the "default" state). The server remembers the current state per session and replays it whenever the device (re)connects or its page reloads, so the same state always yields the same display — prefer states over messages for stability.',
    'Websites read it via the helper: rk.state / useRoomKit().state (name = this asset\'s name, or "default"), or onState(name, handler); declare rendered names in the helper `states` option so the operation UI lists them.',
  ],
  phase: [
    'Game progression stage; data.order sorts phases ascending. Events belong to a phase (or are common with phaseId null).',
    'Registrations applied on phase enter (session start, switchPhase, phase restart): data.deviceStates[] {deviceId, mode:"none"} | {deviceId, mode:"set", stateId, values}, data.deviceWebsites[] {deviceId, mode:"none"} | {deviceId, mode:"set", websiteId, query[]}, data.playerBgms[] {playerId, mode:"none"} | {playerId, mode:"set", bgmId} (always looping). A device/player absent from a list keeps whatever it has; "none" clears/unloads/stops; "set" applies the asset. Applied idempotently — a device already showing the same website URL or looping the same BGM is not reloaded/restarted. Devices offline at phase enter receive their slots when they connect.',
    'Asset updates replace `data` wholesale: read the phase, merge your change into deviceStates/deviceWebsites/playerBgms, and write the whole object back (an update with only {order} wipes the registrations).',
  ],
  event: [
    'The scenario logic unit: data.sequence is the command array (see `rk describe commands`).',
    'phaseId null = common event valid in every phase. once = run at most once per session. allowReentry permits re-trigger while already running.',
    'Prefer `rk sequence get --outline` + `rk sequence edit` for changes, `rk sequence set` for rewrites, over raw asset updates — they resolve/validate refs and preserve trigger config.',
  ],
};

export function assetKindDoc(kind: AssetKind): unknown {
  return {
    kind,
    notes: KIND_NOTES[kind],
    dataJsonSchema: toInputJsonSchema(assetDataSchemas[kind] as z.ZodType),
    createInputJsonSchema: toInputJsonSchema(
      CreateAssetInputSchema.options.find(
        (o) => o.shape.kind.value === kind,
      ) as unknown as z.ZodType,
    ),
  };
}
