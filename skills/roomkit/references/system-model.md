# RoomKit System Model

[RoomKit skill](../SKILL.md)

## Purpose

RoomKit authors and runs escape-room games. A server owns multiple themes, while each session represents one team playing one theme. The server is authoritative for game logic, phase, timer, variables, event-run state, and command delivery. Devices are execution endpoints: they display websites and media, report triggers, and acknowledge commands.

## Entity graph

```text
Theme
├── Tags
├── Assets
│   ├── Device ←─ Player ─→ Device
│   ├── Media: BGM / SFX / Dialogue / Video / Image / File
│   ├── Website / Message / State / Hint
│   ├── Phase
│   └── Event ── phaseId → Phase
│       └── sequence[] ── references other assets
└── Sessions
    ├── current phase / vars / once-run set / timer
    ├── attached device sockets
    ├── concurrent event runs
    └── immutable operational logs
```

Every asset has `id`, `themeId`, `kind`, `name`, `description`, tags, timestamps, and a kind-specific `data` object. Phase and event are asset kinds rather than separate top-level resources. IDs are UUIDs. An optional `key` (theme-unique slug) gives an asset a readable handle for authoring tools; references stored in data stay UUIDs. Codes are unique by theme and kind: device codes cannot collide with devices and hint codes cannot collide with hints.

## Core concepts

- A **theme** is one game title. Duplicate a theme to run multiple physical copies concurrently or to create an editable season snapshot.
- A **device** is a logical endpoint identified by code. It can be a Player stage, a browser, a hardware controller, or a virtual `rk device` socket.
- A **player asset** is an output routing group, not an application. It pairs a speaker device with a screen device and stores subtitle and BGM-ducking configuration.
- A **phase** is an ordered progression stage. Events belong to a phase or are common (`phaseId: null`). A phase may register what devices show while it is active (per-device state and website, per-player looping BGM); registrations are applied idempotently on phase enter.
- A **state** is a durable per-device display state: a field schema whose values are set by `setState`, a phase registration, or an operator. One state is active per device at a time; the server remembers it for the session and replays it on every (re)connect. A **message** is the transient counterpart — delivered once, never remembered.
- An **event** owns trigger configuration and an ordered sequence. Multiple different events may run concurrently.
- A **session** is one run. Production and test sessions share the runtime but differ in concurrency and device-code assignment.

## Session state

```text
created → running ⇄ paused → ended
```

Creating a session does not arm the timer or run system hooks. Starting it arms the countdown, fires `session:start`, and enters the initial phase. An ended session cannot resume. A production theme may have only one non-ended production session; test sessions are unrestricted.

A session persists its current phase, variables, once-event history, verdict, timer state, timestamps, and logs. In memory it also tracks what each device is currently showing — website, state, hint code, and playing media — for the operation dashboard and for reconnect replay. A server restart can recover session state, but in-flight sequence continuations and the in-memory display tracking are lost (interrupted runs are logged; a phase restart re-applies registrations).

## Event eligibility and concurrency

An event fires from its trigger only when it is common or belongs to the current phase. Device trigger names must match `triggerName`. Operators can run any event by hand from the session dashboard; `manualTriggerable` marks the ones offered as quick-run buttons. System events use `session:start`, `phase:enter`, `phase:leave`, or `timer:expired`.

The same event rejects re-entry while already running unless `allowReentry` is true. Other events can run concurrently. A `once` event records its first accepted execution for the session. Restarting a phase clears once history only for events in that phase, not common events.

Trigger payload is JSON. It is available to eval as `ctx.payload`, to interpolated command fields as `{{payload.path}}`, and is passed through `callEvent`.

## Command delivery invariants

- Wire delivery is at-least-once. Every command has an id; clients must deduplicate and re-ack duplicate completed commands.
- Offline-target delivery fails immediately, is logged, and does not block the sequence even when the command was authored to wait.
- Online waited commands block until their acknowledgment, a stop/skip resolves playback, the run is aborted, or the server timeout expires.
- A failed acknowledgment records failure but normally advances the sequence.
- States and hint codes are remembered even for an offline device and applied when it connects; other offline deliveries are dropped.
- Updating an asset replaces its `data` object wholesale. Read, merge, then update unless a specialized sequence tool is used.

## Reconnect replay

When a device connects — late attach, socket blip, or a restarted Player — the server first redelivers still-unacked commands with their original ids (clients dedupe), then replays everything that should currently be active on that device so it ends up on the same display as before:

- the current website (`navigate`, `force: false` — a device already showing that URL does not reload),
- the current state (`state`; websites see `'default'` when none),
- the hint code overlay,
- looping BGM (re-resolved with a fresh media URL and id, carrying `offsetMs` — a device already looping that track keeps playing),
- in-flight video (same id, with `offsetMs` so a restarted device resumes at the elapsed position),
- the phase's registrations for anything the device missed while offline, then the device's `startWebsite` if it still shows nothing.

Replays of already-acked wires carry fresh ids; devices apply them idempotently. Messages, SFX and dialogue are not replayed (dialogue keeps its own hold/continue re-announce). This is why stable displays should be modeled as states and phase registrations rather than messages: a message sent before a reconnect is simply gone.

## Media invariant

File-backed playback carries a `fileKey` and a usable URL. Placeholder playback carries `fileKey: null`, `url: null`, and non-null `durationMs`. Clients simulate the placeholder for that duration and acknowledge normally. Placeholder entries are not included in pre-cache manifests.
