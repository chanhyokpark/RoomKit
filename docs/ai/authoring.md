# Theme and Asset Authoring

[AI documentation index](../TOC_AI.md) · [Sequence commands](./commands.md)

## Safe authoring order

1. Create or select the theme and set `timeLimitMs` (`null` means no countdown).
2. Create device assets with unique codes.
3. Create player assets after their speaker and screen devices exist.
4. Upload files, or create placeholder media while content is missing.
5. Create websites, messages, hints, and other supporting assets.
6. Create ordered phases.
7. Create phase or common events, then set sequences.
8. Validate dangling references and run a test session.

When using MCP, call `describe_asset_kind` before creating an unfamiliar kind. `update_asset` replaces `data` wholesale: first read the current asset, merge intended fields, and write the complete data object. `set_event_sequence` is safer for sequence-only changes because it preserves trigger configuration and generates entry IDs.

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
- **message**: display name plus fields (`key`, `label`, `type`, `required`). Concrete values belong to send-message commands.
- **hint**: unique code, ordered HTML/image steps, optional explicit answer, and arbitrary params.
- **phase**: ascending `order`.
- **event**: phase ownership, trigger kind/name, manual/re-entry/once flags, and sequence.

A device `startWebsite` is delivered as a navigate wire on session start (production and test) before `session:start` hook events, so an authored navigate in a start hook wins. It is also redelivered when the device attaches or reconnects mid-session showing no website with no navigate pending.

## Files and media URLs

MCP `upload_file` accepts an absolute local path, obtains a presigned upload target, and returns a file key. Put that key in the relevant asset data. `get_file_url` returns a short-lived URL for private media. Website image/file assets instead have a stable public `/api/media/{assetId}` route.

For early logic tests, prefer placeholders over invented file keys. The server recognizes a placeholder only when `fileKey` is null and supplies duration-based playback data to clients.

`/api/media/{assetId}` is a stable public route for file-backed image, file, video, BGM, and SFX assets. Fileless images produce a generated SVG using `placeholderRatio`; other fileless kinds return 404. Dialogue lines do not have one asset-level public route. Treat these URLs and hosted sites as public capability URLs, not protected content.

## Phases and events

Phase order determines the initial phase and authoring display. Event `phaseId: null` makes an event common. Use common events for behavior that must be available throughout the game, such as an emergency reset; avoid using common `once` events when operators expect phase restart to reset them.

Trigger names are application-level contracts. Keep them stable and namespaced (`keypad:correct`, `door:opened`) to reduce accidental matches. Device payload must be JSON. Manual and system triggers have null payload.

Broken asset references do not invalidate the entire saved sequence. Runtime skips the broken command, writes a warning, and continues. Treat `set_event_sequence` warnings as authoring failures unless the missing asset is intentionally staged.

## Hosted sites and bulk import

Hosted website ZIPs must contain static output with `index.html` at root. Re-upload atomically replaces the active prefix. External URLs are stored as navigation targets only.

Bulk import supports media ZIPs. Each accepted BGM/SFX/video file becomes a new asset. Dialogue names ending in `_1`, `_2`, and so on group into ordered lines. Import does not deduplicate existing assets, so inspect the result before retrying a partially successful upload.

## Theme lifecycle and transfer

Tags are theme-scoped, have unique names, and may be attached to any asset for Studio filtering. Codes are unique by theme and coded kind: device codes cannot duplicate other device codes, and hint codes cannot duplicate other hint codes, but a device and hint may share the same text.

Theme duplication copies tags and assets, remaps player/event/sequence references, preserves dialogue line IDs and sequence identity where required, and shares immutable storage keys with the source. Use it for another room instance or an editable snapshot on the same server.

Theme export/import is the portable path between servers. The archive contains the theme, tags, assets, and every referenced file/site object. Import creates a new theme with fresh database IDs and storage keys, remaps manifest references, and never overwrites an existing theme. Missing direct file/image references become null (a placeholder only for supporting kinds); missing objects inside an otherwise remapped hosted-site prefix remain 404s. The current MCP tool set supports theme duplication but does not expose archive import/export or bulk/site ZIP import; use Studio or the authenticated REST routes for those operations.
