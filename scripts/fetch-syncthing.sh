#!/usr/bin/env bash
# Downloads Syncthing release binaries and places them under src-tauri/binaries/
# with the target-triple naming Tauri's externalBin expects.
set -euo pipefail

VERSION="v2.1.1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST="$ROOT/src-tauri/binaries"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    -h|--help)
      echo "Usage: $0 [--force]"
      echo "  --force   re-download even if binaries already exist"
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

mkdir -p "$DEST"

# Each entry: <release-platform-tag>|<binary-name-inside-archive>|<tauri-target-triple-filename>
TARGETS=(
  "macos-arm64|syncthing|syncthing-aarch64-apple-darwin"
  "windows-amd64|syncthing.exe|syncthing-x86_64-pc-windows-msvc.exe"
)

fetch_with_retry() {
  local url="$1" out="$2" attempts=5 delay=2
  for ((i=1; i<=attempts; i++)); do
    if curl -fL --connect-timeout 15 --max-time 180 --retry 0 -o "$out" "$url"; then
      return 0
    fi
    echo "  attempt $i/$attempts failed (curl exit $?), retrying in ${delay}s…" >&2
    sleep "$delay"
    delay=$((delay * 2))
  done
  return 1
}

for entry in "${TARGETS[@]}"; do
  IFS='|' read -r platform binname target <<<"$entry"
  out="$DEST/$target"
  if [[ -e "$out" && $FORCE -eq 0 ]]; then
    echo "✓ $target already present (use --force to re-download)"
    continue
  fi
  archive="syncthing-${platform}-${VERSION}.zip"
  url="https://github.com/syncthing/syncthing/releases/download/${VERSION}/${archive}"
  tmp=$(mktemp -d)
  echo "↓ Downloading $archive"
  if ! fetch_with_retry "$url" "$tmp/$archive"; then
    echo "✗ giving up on $archive after retries" >&2
    rm -rf "$tmp"
    exit 1
  fi
  echo "  Unzipping → $target"
  unzip -q "$tmp/$archive" -d "$tmp"
  cp "$tmp/syncthing-${platform}-${VERSION}/$binname" "$out"
  chmod +x "$out"
  if [[ "$target" == *darwin* ]]; then
    xattr -d com.apple.quarantine "$out" 2>/dev/null || true
  fi
  rm -rf "$tmp"
  echo "✓ $target installed"
done

echo
echo "Done. Binaries in $DEST:"
ls -la "$DEST"
