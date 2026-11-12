# RoomKit Player

Tauri application that registers a launcher with RoomKit Server and runs configured device codes in stage windows. Stages own default website/media/subtitle/hint-code rendering, bridge `@roomkit/helper`, pre-cache role-scoped media, and provide test and kiosk behavior.

See the [Player user guide](../../docs/human/player.md) and [Player runtime contract](../../docs/ai/player.md) for launcher, cache, Helper delegation, Android, and kiosk semantics.

## Development

From the repository root after `pnpm install`:

```sh
pnpm --filter @roomkit/shared build
pnpm --filter @roomkit/client build
pnpm dev:player
```

`pnpm dev:player` runs `tauri dev`. For a browser-only UI harness without native cache/windows, use `pnpm --filter player dev:web`.

The launcher requires a RoomKit Server origin. `pnpm infra` starts Server and Studio but does not start Player.

## Checks and builds

```sh
pnpm --filter player check
pnpm --filter player build
pnpm --filter player build:app
pnpm --filter player build:android
pnpm --filter player build:ios <profile.mobileprovision>
```

- `build` compiles only the web frontend.
- `build:app` produces the platform Tauri bundle.
- `build:android` requires the Android SDK/NDK and produces an APK.
- `build:ios` (`build-ios.sh`) requires Xcode, xcodegen, CocoaPods and the `aarch64-apple-ios` Rust target. It archives unsigned, signs with the given provisioning profile and the matching keychain certificate, and writes `src-tauri/target/ios/RoomKit-Player-<version>.ipa`. Run `pnpm --filter player tauri ios init` once beforehand to generate `src-tauri/gen/apple`.

Release CI builds desktop artifacts for macOS arm64, Linux AppImage, and Windows NSIS, plus a signed Android arm64 APK when release secrets are available. Android and iOS use a single stage webview and cannot open multiple device windows. iOS is built locally only; CI does not produce it.
