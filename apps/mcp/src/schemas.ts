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
  phaseId: 'phase',
  eventId: 'event',
  hintId: 'hint',
};

export function commandsDoc(): unknown {
  return {
    notes: [
      'A sequence is an ordered JSON array of command entries; each entry is {id: uuid, type: <command>, ...params}. Omit `id` in set_event_sequence/validate_sequence inputs — missing ids are generated for you.',
      'Asset reference fields (deviceId, playerId, bgmId, ...) take an asset UUID or null. Null/dangling refs are not fatal: the runtime logs and skips that command.',
      'playDialogue.lineCues wedge commands between dialogue lines: {afterLineId: <dialogue line id>, sequence: [...commands]}. playDialogue itself is not allowed inside a cue (use callEvent instead). A cue after the last line never runs.',
      'waitUntilEnd on play commands makes the sequence wait for playback to finish before the next entry. wait.durationMs pauses the sequence.',
      'switchPhase changes the session phase; callEvent runs another event (waitUntilFinish to await it); eval runs JS in a server sandbox (returning false aborts the sequence); endTheme ends the game with a success/fail verdict.',
      'sendMessage.values, navigate query values, and sendWebsiteRequest path/body/headers support {{vars.x}} and {{payload.x}} template interpolation at run time.',
      'sendWebsiteRequest sends HTTP from the RoomKit server to a URL resolved from a website asset; waitUntilEnd waits through the complete response body.',
      `Events (kind "event" assets) hold the sequence in data.sequence and are fired by their trigger: triggerKind "device" + triggerName = a device-reported event name, "manual" = fired by an operator (control_session trigger_event), "system" + one of ${SystemTriggerSchema.options.join('/')}.`,
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
    'fileKey comes from upload_file. fileKey null = placeholder asset: clients simulate playback for durationMs.',
    'fadeInMs/fadeOutMs control volume ramps; stopping or replacing BGM uses fadeOutMs (crossfade).',
  ],
  dialogue: [
    'lines[] play in array order; each line needs an id (uuid), fileKey (or null placeholder + durationMs), and subtitleHtml.',
    'Line ids anchor playDialogue lineCues — keep them stable when editing.',
  ],
  sfx: ['fileKey null = placeholder: clients simulate playback for durationMs.'],
  video: [
    'frame places the video surface on the stage in percent; null = fullscreen.',
    'params is free-form JSON forwarded to the website for rendering.',
  ],
  image: [
    'Static resource for hosted websites, served publicly at /api/media/{assetId} (stable URL).',
    'fileKey null serves a generated placeholder with placeholderRatio.',
  ],
  file: ['Arbitrary file served publicly at /api/media/{assetId}; 404 until fileKey is set.'],
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
  ],
  phase: ['Game progression stage; data.order sorts phases ascending. Events belong to a phase (or are common with phaseId null).'],
  event: [
    'The scenario logic unit: data.sequence is the command array (see describe_commands).',
    'phaseId null = common event valid in every phase. once = run at most once per session. allowReentry permits re-trigger while already running.',
    'Prefer get_event_sequence/set_event_sequence over raw asset updates — they validate refs and preserve trigger config.',
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
