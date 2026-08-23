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

- **device**: `code`, `displayName`, `isHintDevice`, and default hint-code overlay CSS.
- **player**: `speakerDeviceId`, `screenDeviceId`, `subtitleCss`, and optional dialogue/SFX BGM duck percentages. Playback commands target this asset.
- **bgm**: optional file, placeholder duration, fade-in, and fade-out. Loop is chosen by the command.
- **sfx**: optional file and placeholder duration.
- **video**: optional file, placeholder duration, full-screen or percentage frame, and arbitrary params for a delegated renderer.
- **dialogue**: ordered lines with stable IDs, optional file and duration, subtitle HTML, optional `holdBefore`, keep-subtitle flag, and arbitrary params.
- **image/file**: public website resource. A fileless image can provide a generated layout placeholder.
- **website**: external URL or hosted-site storage metadata.
- **message**: display name plus fields (`key`, `label`, `type`, `required`). Concrete values belong to send-message commands.
- **hint**: unique code, ordered HTML/image steps, optional explicit answer, and arbitrary params.
- **phase**: ascending `order`.
- **event**: phase ownership, trigger kind/name, manual/re-entry/once flags, and sequence.

## Files and media URLs

MCP `upload_file` accepts an absolute local path, obtains a presigned upload target, and returns a file key. Put that key in the relevant asset data. `get_file_url` returns a short-lived URL for private media. Website image/file assets instead have a stable public `/api/media/{assetId}` route.

For early logic tests, prefer placeholders over invented file keys. The server recognizes a placeholder only when `fileKey` is null and supplies duration-based playback data to clients.

## Phases and events

Phase order determines the initial phase and authoring display. Event `phaseId: null` makes an event common. Use common events for behavior that must be available throughout the game, such as an emergency reset; avoid using common `once` events when operators expect phase restart to reset them.

Trigger names are application-level contracts. Keep them stable and namespaced (`keypad:correct`, `door:opened`) to reduce accidental matches. Device payload must be JSON. Manual and system triggers have null payload.

Broken asset references do not invalidate the entire saved sequence. Runtime skips the broken command, writes a warning, and continues. Treat `set_event_sequence` warnings as authoring failures unless the missing asset is intentionally staged.

## Hosted sites and bulk import

Hosted website ZIPs must contain static output with `index.html` at root. Re-upload atomically replaces the active prefix. External URLs are stored as navigation targets only.

Bulk import supports media ZIPs. Each accepted BGM/SFX/video file becomes a new asset. Dialogue names ending in `_1`, `_2`, and so on group into ordered lines. Import does not deduplicate existing assets, so inspect the result before retrying a partially successful upload.
