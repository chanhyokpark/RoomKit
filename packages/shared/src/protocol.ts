import { z } from 'zod';
import { JsonValueSchema } from './json.js';
import { PlayChannelSchema } from './wire.js';

/**
 * Socket.io wire contract for M2+. Only names and payload shapes live here —
 * no runtime code.
 */

export const DEVICE_NAMESPACE = '/device';
export const ADMIN_NAMESPACE = '/admin';
export const PLAYER_NAMESPACE = '/player';

/** Events on the /device namespace. */
export const DeviceEvents = {
  /** S→C: sent once on successful attach (device identity + session state). */
  welcome: 'welcome',
  /** S→C: deliver a command to the device. */
  command: 'command',
  /** C→S: command completion report; resolves waitUntilEnd. */
  ack: 'ack',
  /**
   * C→S: device reports a game event (sensor, button, ...). May carry a
   * socket.io ack (`TriggerAck`), answered once every event run the trigger
   * started has completely finished.
   */
  trigger: 'trigger',
  /**
   * C→S from the speaker device as each dialogue line starts;
   * S→C relayed to the screen device for subtitle sync.
   */
  progress: 'progress',
  /** C→S: hint device submits an entered code. */
  hintSubmit: 'hint:submit',
  /** C→S: hint device requests a specific step of an already-shown hint. */
  hintNext: 'hint:next',
  /** S→C: show a hint step on the hint device. */
  hintShow: 'hint:show',
  /** S→C: hint request rejected (wrong code, bad step, unauthorized, paused). */
  hintError: 'hint:error',
  /** S→C: broadcast of session state (phase, pause, timer). */
  sessionState: 'session:state',
  /**
   * C→S with a socket.io ack: request a fresh `SessionState` snapshot (null
   * when the socket is not attached to a live session). Used by clients to
   * resynchronize their locally-ticking timer.
   */
  sessionSync: 'session:sync',
  /**
   * C→S with a socket.io ack: request the media manifest this device should
   * pre-cache (`DeviceAssetManifest`, or null when the socket has no theme).
   * Works while attached to a session and while lobby-parked.
   */
  assetManifest: 'assets:manifest',
  /**
   * C→S: the player reports the `@roomkit/helper` version of the website
   * loaded in this device window (`HelperInfo`), sent on every helper hello.
   */
  helperInfo: 'helper:info',
} as const;

/** Events on the /admin namespace (studio). */
export const AdminEvents = {
  sessionState: 'session:state',
  log: 'log',
  deviceStatus: 'device:status',
  /** Live snapshot of a session's running event sequences. */
  sessionRuns: 'session:runs',
  /** Live snapshot of a session's playing media / device websites. */
  sessionMedia: 'session:media',
  /** A player launcher connected or disconnected. */
  playerStatus: 'player:status',
  /** Operator notification pushed by the `notify` sequence command. */
  notification: 'notification',
  /** Website-test run snapshot (`WebsiteTestRun`). */
  websiteTestState: 'websiteTest:state',
  /** Website-test activity log entry (`WebsiteTestActivity`). */
  websiteTestActivity: 'websiteTest:activity',
} as const;

/** Events on the /player namespace (player launcher, not device windows). */
export const PlayerEvents = {
  /**
   * S→C: a test session was created targeting this player — open a stage
   * window per device with the generated codes (`PlayerTestStart`).
   */
  testStart: 'test:start',
  /**
   * S→C: a website test targets this player — open one stage window with the
   * generated code (`PlayerWebsiteTestStart`); the URL arrives as a navigate
   * wire once the window attaches.
   */
  websiteTestStart: 'websiteTest:start',
  /** S→C: a website test ended — close its window (`PlayerWebsiteTestStop`). */
  websiteTestStop: 'websiteTest:stop',
} as const;

/**
 * /player connection auth. `playerId` is generated and persisted by the
 * player app; `playerName` is the operator-facing label shown in studio.
 * Unauthenticated like /device — players hold no secret.
 */
export const PlayerAuthSchema = z.object({
  playerId: z.uuid(),
  playerName: z.string().min(1),
  /** Player app version; absent on players predating version reporting. */
  version: z.string().optional(),
});
export type PlayerAuth = z.infer<typeof PlayerAuthSchema>;

/** /admin `player:status` payload. */
export const PlayerStatusSchema = z.object({
  playerId: z.uuid(),
  playerName: z.string(),
  online: z.boolean(),
  /**
   * Player app version: null = the player sent none (predates reporting),
   * absent = the server predates version relaying.
   */
  version: z.string().nullable().optional(),
});
export type PlayerStatus = z.infer<typeof PlayerStatusSchema>;

/** /device connection auth payload. `deviceName` is an optional log label. */
export const DeviceAuthSchema = z.object({
  deviceCode: z.string().min(1),
  deviceName: z.string().optional(),
  /** @roomkit/client version; absent on clients predating version reporting. */
  clientVersion: z.string().optional(),
});
export type DeviceAuth = z.infer<typeof DeviceAuthSchema>;

/**
 * connect_error messages that are fatal — the client must stop reconnecting
 * (and forget a stored test code). Any other connect_error is transient.
 */
export const FATAL_CONNECT_ERRORS = ['invalid_code', 'session_ended'] as const;
export type FatalConnectError = (typeof FATAL_CONNECT_ERRORS)[number];

export const AckSchema = z.object({
  commandId: z.uuid(),
  status: z.enum(['done', 'failed']),
});
export type Ack = z.infer<typeof AckSchema>;

/**
 * `helper:info` payload — the helper bundle version of the website loaded in
 * a player device window. Null = the helper's hello carried no version (a
 * bundle predating version reporting).
 */
export const HelperInfoSchema = z.object({ version: z.string().nullable() });
export type HelperInfo = z.infer<typeof HelperInfoSchema>;

export const TriggerSchema = z.object({
  event: z.string().min(1),
  payload: JsonValueSchema.optional(),
});
export type Trigger = z.infer<typeof TriggerSchema>;

/**
 * socket.io ack for `trigger`, sent only when the client requested one: every
 * event run the trigger started has completely finished (immediately when
 * nothing listened or was admitted). A command failing inside a run does not
 * turn the ack into an error — the run still finishes.
 */
export const TriggerAckSchema = z.object({ done: z.literal(true) });
export type TriggerAck = z.infer<typeof TriggerAckSchema>;

export const HintSubmitSchema = z.object({ code: z.string().min(1) });
export type HintSubmit = z.infer<typeof HintSubmitSchema>;

/** Stateless step advance: the client asks for the exact step it wants next. */
export const HintNextSchema = z.object({
  hintId: z.uuid(),
  /** 0-based step being requested; server validates bounds. */
  step: z.number().int().nonnegative(),
});
export type HintNext = z.infer<typeof HintNextSchema>;

export const HintShowSchema = z.object({
  hintId: z.uuid(),
  /** Theme-unique hint code (also shown for admin-pushed hints). */
  code: z.string(),
  /** 0-based step index. */
  step: z.number().int().nonnegative(),
  stepCount: z.number().int().positive(),
  textHtml: z.string(),
  imageUrl: z.url().nullable(),
});
export type HintShow = z.infer<typeof HintShowSchema>;

export const HintErrorReasonSchema = z.enum([
  /** hint:submit — code matched no hint in the theme. */
  'unknown_code',
  /** hint:next — hintId is not a hint in this theme. */
  'unknown_hint',
  /** hint:next — step is out of range. */
  'invalid_step',
  /** Sender's device asset is not flagged isHintDevice. */
  'not_hint_device',
  /** Session is paused, ended, or not live. */
  'session_not_running',
]);
export type HintErrorReason = z.infer<typeof HintErrorReasonSchema>;

export const HintErrorSchema = z.object({
  reason: HintErrorReasonSchema,
  /** Echo of the submitted code (unknown_code only). */
  code: z.string().optional(),
  hintId: z.uuid().optional(),
});
export type HintError = z.infer<typeof HintErrorSchema>;

export const SessionModeSchema = z.enum(['test', 'production']);
export type SessionMode = z.infer<typeof SessionModeSchema>;

/** Sessions are created idle ('created') and started explicitly by the operator. */
export const SessionStateValueSchema = z.enum(['created', 'running', 'paused', 'ended']);
export type SessionStateValue = z.infer<typeof SessionStateValueSchema>;

export const TimerStateSchema = z.enum(['running', 'paused', 'expired']);
export type TimerState = z.infer<typeof TimerStateSchema>;

/** Game outcome recorded by the endTheme command; null until it runs. */
export const VerdictSchema = z.enum(['success', 'fail']);
export type Verdict = z.infer<typeof VerdictSchema>;

export const SessionStateSchema = z.object({
  sessionId: z.uuid(),
  themeId: z.uuid(),
  mode: SessionModeSchema,
  phaseId: z.uuid().nullable(),
  state: SessionStateValueSchema,
  /** Defaulted so payloads from servers predating the field still parse. */
  verdict: VerdictSchema.nullable().default(null),
  /** Null when the theme has no timer. */
  timerState: TimerStateSchema.nullable(),
  /**
   * Snapshot at emit time; null when the theme has no timer. Clients tick
   * locally while timerState is 'running' — no per-second broadcasts.
   */
  timerRemainingMs: z.number().int().nonnegative().nullable(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

/** Payload of the /device `welcome` event, sent once on successful attach. */
export const WelcomeSchema = z.object({
  device: z.object({
    id: z.uuid(),
    name: z.string(),
    displayName: z.string(),
  }),
  session: SessionStateSchema,
});
export type Welcome = z.infer<typeof WelcomeSchema>;

/**
 * One cacheable media file for a device. Upload fileKeys are immutable
 * (`themes/{themeId}/{uuid}/{filename}`), so fileKey presence in a local
 * cache is the freshness check — no hash needed. Dialogues contribute one
 * entry per line.
 */
export const DeviceAssetEntrySchema = z.object({
  assetId: z.uuid(),
  kind: z.enum(['bgm', 'sfx', 'video', 'dialogue']),
  name: z.string(),
  /** Dialogue line id (dialogue entries only). */
  lineId: z.uuid().optional(),
  fileKey: z.string(),
  /** Presigned GET URL for downloading into the cache. */
  url: z.url(),
});
export type DeviceAssetEntry = z.infer<typeof DeviceAssetEntrySchema>;

/** Ack payload of `assets:manifest`. */
export const DeviceAssetManifestSchema = z.object({
  themeId: z.uuid(),
  deviceId: z.uuid(),
  /** Epoch ms when the presigned urls expire; re-request before then. */
  urlExpiresAt: z.number().int().nonnegative(),
  entries: z.array(DeviceAssetEntrySchema),
});
export type DeviceAssetManifest = z.infer<typeof DeviceAssetManifestSchema>;

/** One in-flight event run inside a session engine. */
export const RunningEventSchema = z.object({
  runId: z.uuid(),
  eventId: z.uuid(),
  eventName: z.string(),
  /** Epoch ms when the run started. */
  startedAt: z.number().int().nonnegative(),
  /** 0-based index of the sequence entry currently executing. */
  entryIndex: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  /** Command type of the current entry; null for an empty sequence. */
  commandType: z.string().nullable(),
});
export type RunningEvent = z.infer<typeof RunningEventSchema>;

/** /admin `session:runs` payload — full snapshot, replaces the previous one. */
export const SessionRunsSchema = z.object({
  sessionId: z.uuid(),
  runs: z.array(RunningEventSchema),
});
export type SessionRuns = z.infer<typeof SessionRunsSchema>;

/**
 * One media playback the engine believes is in flight on a device. Tracked
 * from the play wire's delivery until its ack (looping BGM: until stopped or
 * replaced — its ack fires on playback start). The operator stops it with the
 * matching stop command; the device then acks the play wire 'done', so a
 * sequence awaiting `waitUntilEnd` continues as if playback ended normally.
 */
export const PlayingMediaSchema = z.object({
  /** The play wire's delivery id — the ack that ends this entry. */
  commandId: z.uuid(),
  deviceId: z.uuid(),
  channel: PlayChannelSchema,
  playerId: z.uuid(),
  assetId: z.uuid(),
  assetName: z.string(),
  /** BGM only; a looping track never acks 'finished', so it stays until stopped. */
  loop: z.boolean().default(false),
  /** Epoch ms when the play wire was delivered. */
  startedAt: z.number().int().nonnegative(),
});
export type PlayingMedia = z.infer<typeof PlayingMediaSchema>;

/** The website a device was last navigated to (cleared by a device reset). */
export const DeviceWebsiteSchema = z.object({
  deviceId: z.uuid(),
  websiteId: z.uuid(),
  url: z.url(),
  /** Epoch ms of the navigate delivery. */
  startedAt: z.number().int().nonnegative(),
});
export type DeviceWebsite = z.infer<typeof DeviceWebsiteSchema>;

/** /admin `session:media` payload — full snapshot, replaces the previous one. */
export const SessionMediaSchema = z.object({
  sessionId: z.uuid(),
  playing: z.array(PlayingMediaSchema),
  websites: z.array(DeviceWebsiteSchema),
});
export type SessionMedia = z.infer<typeof SessionMediaSchema>;

/** /admin connection auth payload (admin JWT). */
export const AdminAuthSchema = z.object({ token: z.string().min(1) });
export type AdminAuth = z.infer<typeof AdminAuthSchema>;

/** /admin `notification` payload — shown as a toast on the operation screen. */
export const SessionNotificationSchema = z.object({
  sessionId: z.uuid(),
  message: z.string().min(1),
});
export type SessionNotification = z.infer<typeof SessionNotificationSchema>;

/** /admin `device:status` payload. */
export const DeviceStatusSchema = z.object({
  sessionId: z.uuid(),
  deviceId: z.uuid(),
  deviceName: z.string(),
  online: z.boolean(),
  /**
   * @roomkit/client version of the device's socket: null = the client sent
   * none (predates reporting), absent = the server predates version relaying.
   */
  clientVersion: z.string().nullable().optional(),
  /**
   * @roomkit/helper version of the website loaded on the device (relayed by
   * the player via `helper:info`): null = a helper said hello without a
   * version, absent = no helper detected (or old server).
   */
  helperVersion: z.string().nullable().optional(),
});
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;
