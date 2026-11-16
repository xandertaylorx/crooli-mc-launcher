#!/bin/bash
# Installs the latest Crooli MC Launcher on a Mac: downloads it from GitHub, puts it in Applications,
# clears the "unsigned app" flag so it opens, and starts it.
#   curl -fsSL https://mclauncher.crooli.com/install.sh | bash
# Read it first if you like: https://mclauncher.crooli.com/install.sh
# Options (environment): INSTALL_DIR=/some/folder (default /Applications), NO_OPEN=1 (don't start it afterwards)
set -euo pipefail

REPO="xandertaylorx/crooli-mc-launcher"
APP="Crooli MC Launcher.app"
DEST="${INSTALL_DIR:-/Applications}"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf 'Something went wrong: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "this installer is for macOS. On Windows, use the PowerShell command on https://mclauncher.crooli.com/downloads"

# Apple Silicon or Intel (including a shell that runs under Rosetta)
ARCH="x64"
if [ "$(uname -m)" = "arm64" ] || [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then ARCH="arm64"; fi

say "Finding the latest version…"
JSON="$(curl -fsSL -H 'User-Agent: crooli-installer' "https://api.github.com/repos/$REPO/releases/latest")" || die "couldn't reach GitHub."
TAG="$(printf '%s\n' "$JSON" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)"

# The asset for this Mac: its download address and the checksum GitHub publishes for it.
# (Flatten the JSON, then split it after each "}" so an asset's digest and address land on the same line.)
FRAG="$(printf '%s' "$JSON" | tr -d '\n' | tr '}' '\n' | grep "\"browser_download_url\": *\"[^\"]*mac-$ARCH\.dmg\"" | head -1 || true)"
URL="$(printf '%s' "$FRAG" | sed -n 's/.*"browser_download_url": *"\([^"]*\)".*/\1/p')"
SUM="$(printf '%s' "$FRAG" | sed -n 's/.*"digest": *"sha256:\([0-9a-f]*\)".*/\1/p')"
[ -n "${URL:-}" ] || die "couldn't find a download for this Mac ($ARCH)."

WORK="$(mktemp -d /tmp/crooli-install.XXXXXX)"
MNT="$WORK/mnt"
cleanup() { hdiutil detach "$MNT" -quiet -force >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

say "Downloading Crooli MC Launcher ${TAG#v}…"
curl -fL --progress-bar -o "$WORK/app.dmg" "$URL" || die "the download failed."

if [ -n "${SUM:-}" ]; then
  GOT="$(shasum -a 256 "$WORK/app.dmg" | awk '{print $1}')"
  [ "$GOT" = "$SUM" ] || die "the download doesn't match its checksum, so it was not installed."
fi

say "Installing…"
mkdir -p "$MNT"
hdiutil attach -nobrowse -noverify -noautoopen -readonly -mountpoint "$MNT" "$WORK/app.dmg" >/dev/null 2>&1 \
  || diskutil image attach --mountOptions nobrowse --readOnly --mountPoint "$MNT" "$WORK/app.dmg" >/dev/null 2>&1 \
  || die "couldn't open the download."
[ -d "$MNT/$APP" ] || die "the download didn't contain the app."

# Quit an older copy that's running, so it can be replaced
osascript -e 'tell application "Crooli MC Launcher" to quit' >/dev/null 2>&1 || true
sleep 1

if [ ! -w "$DEST" ] && [ "$DEST" = "/Applications" ]; then
  DEST="$HOME/Applications"; mkdir -p "$DEST"
  say "Applications isn't writable for this user, so it's going in $DEST instead."
fi
rm -rf "$DEST/$APP"
ditto "$MNT/$APP" "$DEST/$APP" || die "couldn't copy the app into $DEST."
xattr -cr "$DEST/$APP" 2>/dev/null || true

say "Installed in $DEST."
if [ -z "${NO_OPEN:-}" ]; then open "$DEST/$APP"; fi
