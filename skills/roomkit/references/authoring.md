# Theme and Asset Authoring

[RoomKit skill](../SKILL.md) · [Sequence commands](./commands.md)

## Safe authoring order

1. Create or select the theme and set `timeLimitMs` (`null` means no countdown).
2. Create device assets with unique codes.
3. Create player assets after their speaker and screen devices exist.
4. Upload files, or create placeholder media while content is missing.
5. Create websites, states, messages, hints, and other supporting assets.
6. Create ordered phases and register what each phase should show (device states/websites, player BGM).
7. Create phase or common events, then set sequences.
8. Validate dangling references and run a test session.

Run `rk describe asset <kind>` before creating an unfamiliar kind. `rk asset update --data` replaces `data` wholesale: first `rk asset get`, merge intended fields, and write the complete data object. `rk sequence set`/`rk sequence edit` are safer for sequence-only changes because they preserve trigger configuration and generate entry IDs.

## Asset data responsibilities

- **device**: `code`, `displayName`, `isHintDevice`, default hint-code overlay CSS, and optional `startWebsite` (a website reference plus query pairs; query values support `{{vars.x}}` interpolation like the navigate command).
- **player**: `speakerDeviceId`, `screenDeviceId`, `subtitleCss`, and optional dialogue/SFX BGM duck percentages. Playback commands target this asset.
- **bgm**: optional file, placeholder duration, fade-in, and fade-out. Loop is chosen by the command.
- **sfx**: optional file and placeholder duration.
- **video**: optional file, placeholder duration, full-screen or percentage frame, and arbitrary params for a delegated renderer.
- **dialogue**: ordered lines with stable IDs, optional file and duration, subtitle HTML, keep-subtitle flag, and arbitrary params. `holdBefore` is derived on the playback wire from `playDialogue.lineCues`; it is not authored in dialogue asset data.
- **image**: public website resource. A fileless image serves a generated layout placeholder using `placeholderRatio`.
- **file**: arbitrary public website resource; it returns 404 until `fileKey` is set.
- **website**: external URL or hosted-site storage metadata.
- **message**: display name plus fields (`key`, `label`, `type`, `required`). Concrete values belong to send-message commands. Messages are transient: not remembered and not replayed on reconnect — use them for effects and transitions.
- **state**: same shape as message (display name plus fields). A durable per-device display state: `setState` sets one (replacing the device's previous state), `clearState` clears it, and the runtime remembers the current state per device for the session and replays it whenever the device (re)connects or its page reloads. One state is active per device at a time. Use states for anything a screen should keep showing; the website reads it as `rk.state` / `onState(name, …)` and sees `'default'` when none is active.
- **hint**: unique code, ordered HTML/image steps, optional explicit answer, and arbitrary params forwarded with the code overlay and every shown step.
- **phase**: ascending `order`, plus optional registrations applied when the phase begins: `deviceStates[]` (`{deviceId, mode: 'none'}` or `{deviceId, mode: 'set', stateId, values}`), `deviceWebsites[]` (`{deviceId, mode: 'none'}` or `{deviceId, mode: 'set', websiteId, query}`), and `playerBgms[]` (`{playerId, mode: 'none'}` or `{playerId, mode: 'set', bgmId}`, always looping). A device/player absent from a list is **kept** (left untouched); `none` clears the state / unloads the website / stops the BGM; `set` applies the asset. Read-merge-update: an update with only `{order}` wipes the registrations.
- **event**: phase ownership, trigger kind/name, manual/re-entry/once flags, and sequence. Sequence entry ids are any string unique within the sequence (Studio generates uuids; CLI authors may use readable ids).

Every asset also has an optional top-level `key`: a theme-unique slug (letters, digits, `_`, `.`, `-`; not uuid-shaped) meant for authors and agents. Stored references between assets remain uuids; `rk` resolves keys to uuids on input. Keys survive duplication and export/import. Studio does not edit keys yet.

A device `startWebsite` is delivered as a navigate wire on session start (production and test) before `session:start` hook events, so an authored navigate in a start hook wins. It is skipped for a device whose phase registration already put a website on it, and it is also sent when a device attaches mid-session with no website tracked at all.

### Phase registrations

Phase registrations are applied on every phase enter — session start (initial phase), `switchPhase`, and a phase restart — before the `phase:enter` hooks, so an authored command in a hook still wins. Application is **idempotent**: a device already showing the registered website URL, already holding the identical state, or already looping the registered BGM on that player is left alone, so re-entering a phase or moving between phases with the same registrations never flickers. A device that was offline when the phase began receives its slots when it connects (only where nothing else is active by then).

Prefer registrations over `phase:enter` events for "what this phase looks like": they survive reconnects and late joins without extra logic, whereas a navigate/playBgm in a hook runs once and re-runs the media unconditionally.

## Files and media URLs

`rk upload <file>` obtains a presigned upload target and returns a file key (`--set <assetRef>` writes it into a media asset directly). Put that key in the relevant asset data. `rk file url <key>` returns a short-lived URL for private media. Website image/file assets instead have a stable public `/api/media/{assetId}` route.

For early logic tests, prefer placeholders over invented file keys. The server recognizes a placeholder only when `fileKey` is null and supplies duration-based playback data to clients.

`/api/media/{assetId}` is a stable public route for file-backed image, file, video, BGM, and SFX assets. Fileless images produce a generated SVG using `placeholderRatio`; other fileless kinds return 404. Dialogue lines do not have one asset-level public route. Treat these URLs and hosted sites as public capability URLs, not protected content.

## Phases and events

Phase order determines the initial phase and authoring display. Event `phaseId: null` makes an event common. Use common events for behavior that must be available throughout the game, such as an emergency reset; avoid using common `once` events when operators expect phase restart to reset them.

Only use manual flag if it's explicitly required for operator to manually run that event as it can't be automated; every event could be manually executed by operator on emergency anyway.

Trigger names are application-level contracts. Keep them stable and namespaced (`keypad:correct`, `door:opened`) to reduce accidental matches. Device payload must be JSON. Manual and system triggers have null payload.

Broken asset references do not invalidate the entire saved sequence. Runtime skips the broken command, writes a warning, and continues. Treat `rk sequence set`/`edit` warnings as authoring failures unless the missing asset is intentionally staged.

## Hosted sites and bulk import

Hosted website ZIPs must contain static output with `index.html` at root. Re-upload atomically replaces the active prefix. External URLs are stored as navigation targets only.

Bulk import supports media ZIPs. Each accepted BGM/SFX/video file becomes a new asset. Dialogue names ending in `_1`, `_2`, and so on group into ordered lines. Import does not deduplicate existing assets, so inspect the result before retrying a partially successful upload.

## Theme lifecycle and transfer

Tags are theme-scoped, have unique names, and may be attached to any asset for Studio filtering. Codes are unique by theme and coded kind: device codes cannot duplicate other device codes, and hint codes cannot duplicate other hint codes, but a device and hint may share the same text.

Theme duplication copies tags and assets, remaps player/event/sequence references, preserves dialogue line IDs and sequence identity where required, and shares immutable storage keys with the source. Use it for another room instance or an editable snapshot on the same server.

Theme export/import is the portable path between servers. The archive contains the theme, tags, assets, and every referenced file/site object. Import creates a new theme with fresh database IDs and storage keys, remaps manifest references, and never overwrites an existing theme. Missing direct file/image references become null (a placeholder only for supporting kinds); missing objects inside an otherwise remapped hosted-site prefix remain 404s. The CLI covers all of these: `rk theme duplicate`, `rk theme export`/`rk theme import`, `rk import media <kind> <zip>`, and `rk deploy` for hosted sites.
