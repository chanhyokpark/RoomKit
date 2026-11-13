#!/usr/bin/env bash
# Build the iOS Player and package it as an .ipa signed with a provisioning
# profile you hand in — no Xcode account, automatic signing or CI involved.
#
#   ./build-ios.sh <profile.mobileprovision> [extra `tauri ios build` args]
#   ROOMKIT_IOS_PROFILE=<profile.mobileprovision> ./build-ios.sh
#
# Tauri archives the app unsigned; this script then signs it the way Xcode
# would: the profile is embedded, the entitlements come from the profile, and
# the signing identity is whichever keychain certificate the profile lists.
# The .ipa installs on the devices provisioned in that profile:
#
#   xcrun devicectl device install app --device <udid> <ipa>
#
# Needs Xcode, xcodegen, CocoaPods and the Rust iOS target
# (`rustup target add aarch64-apple-ios`); with Xcode 27+ also rustup's
# llvm-tools component.
set -euo pipefail
cd "$(dirname "$0")"

die() {
	echo "build-ios: $*" >&2
	exit 1
}

PROFILE="${ROOMKIT_IOS_PROFILE:-}"
if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then
	PROFILE="$1"
	shift
fi
[ -n "$PROFILE" ] || die "usage: $0 <profile.mobileprovision> [tauri ios build args]"
[ -f "$PROFILE" ] || die "provisioning profile not found: $PROFILE"
PROFILE="$(cd "$(dirname "$PROFILE")" && pwd)/$(basename "$PROFILE")"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

plist_get() { plutil -extract "$2" raw -o - "$1"; }

# --- profile -----------------------------------------------------------------
security cms -D -i "$PROFILE" -o "$WORK/profile.plist" 2>/dev/null ||
	die "cannot decode $PROFILE (not a provisioning profile?)"

PROFILE_NAME="$(plist_get "$WORK/profile.plist" Name)"
TEAM_ID="$(plist_get "$WORK/profile.plist" TeamIdentifier.0)"
APP_ID_PATTERN="$(plist_get "$WORK/profile.plist" Entitlements.application-identifier)"
EXPIRES="$(plist_get "$WORK/profile.plist" ExpirationDate)"
BUNDLE_ID="$(plist_get src-tauri/tauri.conf.json identifier)"
VERSION="$(plist_get src-tauri/tauri.conf.json version)"
PRODUCT_NAME="$(plist_get src-tauri/tauri.conf.json productName)"

if [ "$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$EXPIRES" +%s)" -le "$(date -u +%s)" ]; then
	die "profile \"$PROFILE_NAME\" expired on $EXPIRES"
fi
# The profile's app id is `<team>.<bundle id>`, possibly ending in a wildcard.
# shellcheck disable=SC2254
case "$TEAM_ID.$BUNDLE_ID" in
$APP_ID_PATTERN) ;;
*) die "profile \"$PROFILE_NAME\" is for $APP_ID_PATTERN, not $TEAM_ID.$BUNDLE_ID" ;;
esac

# Signing identity: the first certificate of the profile that has its private
# key in a keychain.
IDENTITIES="$(security find-identity -v -p codesigning)"
IDENTITY=""
index=0
while /usr/libexec/PlistBuddy -c "Print :DeveloperCertificates:$index" "$WORK/profile.plist" \
	>"$WORK/cert.der" 2>/dev/null; do
	sha1="$(openssl x509 -inform DER -in "$WORK/cert.der" -noout -fingerprint -sha1 |
		sed 's/.*=//; s/://g')"
	if echo "$IDENTITIES" | grep -q "$sha1"; then
		IDENTITY="$sha1"
		break
	fi
	index=$((index + 1))
done
[ -n "$IDENTITY" ] ||
	die "no certificate of profile \"$PROFILE_NAME\" has its private key in your keychain"
IDENTITY_NAME="$(echo "$IDENTITIES" | grep "$IDENTITY" | sed 's/.*"\(.*\)".*/\1/' | head -1)"

# Entitlements as Xcode derives them: the profile's, with the wildcard app id
# resolved to this app.
/usr/libexec/PlistBuddy -x -c 'Print :Entitlements' "$WORK/profile.plist" |
	sed "s/$TEAM_ID\\.\\*/$TEAM_ID.$BUNDLE_ID/g" >"$WORK/entitlements.plist"
plutil -lint -s "$WORK/entitlements.plist" || die "could not derive entitlements from the profile"

echo "build-ios: $PRODUCT_NAME $VERSION ($BUNDLE_ID)"
echo "build-ios: profile  \"$PROFILE_NAME\" (team $TEAM_ID, expires $EXPIRES)"
echo "build-ios: identity \"$IDENTITY_NAME\""

# --- build -------------------------------------------------------------------
if [ ! -d src-tauri/gen/apple ]; then
	die "src-tauri/gen/apple is missing — run \`pnpm tauri ios init\` once and commit it"
fi
# Xcode 27's SwiftPM hides the Swift exports tauri links against; swift-rs
# re-exports them with llvm-objcopy and the link fails without it.
XCODE_MAJOR="$(xcodebuild -version | sed -n 's/^Xcode \([0-9]*\).*/\1/p')"
if [ "${XCODE_MAJOR:-0}" -ge 27 ] && ! rustup component list --installed | grep -q '^llvm-tools'; then
	die "Xcode $XCODE_MAJOR needs rustup's llvm-tools: run \`rustup component add llvm-tools\`"
fi
APPLE_DEVELOPMENT_TEAM="$TEAM_ID" pnpm tauri ios build --no-sign "$@"

APP="$(find src-tauri/gen/apple/build -maxdepth 4 -type d \
	-path '*.xcarchive/Products/Applications/*.app' | head -1)"
[ -n "$APP" ] || die "tauri produced no .app under src-tauri/gen/apple/build"

# --- sign --------------------------------------------------------------------
mkdir "$WORK/Payload"
cp -R "$APP" "$WORK/Payload/"
SIGNED="$WORK/Payload/$(basename "$APP")"
cp "$PROFILE" "$SIGNED/embedded.mobileprovision"

# Inside out: nested code first, the app (with entitlements) last.
if [ -d "$SIGNED/Frameworks" ]; then
	find "$SIGNED/Frameworks" -depth \( -name '*.framework' -o -name '*.dylib' \) -print0 |
		while IFS= read -r -d '' nested; do
			codesign --force --sign "$IDENTITY" --timestamp=none "$nested"
		done
fi
codesign --force --sign "$IDENTITY" --timestamp=none \
	--entitlements "$WORK/entitlements.plist" --generate-entitlement-der "$SIGNED"
codesign --verify --deep --strict "$SIGNED" || die "signature verification failed"

# --- package -----------------------------------------------------------------
OUT_DIR="src-tauri/target/ios"
IPA="$OUT_DIR/RoomKit-Player-$VERSION.ipa"
mkdir -p "$OUT_DIR"
rm -f "$IPA"
(cd "$WORK" && zip -qry out.ipa Payload)
mv "$WORK/out.ipa" "$IPA"

echo "build-ios: $(pwd)/$IPA"
