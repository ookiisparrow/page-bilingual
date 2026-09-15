#!/usr/bin/env bash
# Pack MV3 extension as CRX3 for Edge mobile sideload. Key stays out of git.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -pe "require('$ROOT/manifest.json').version")"
OUT="${1:-$ROOT/dist/page-bilingual-$VERSION.crx}"
KEY="${CRX_PRIVATE_KEY_PATH:-$ROOT/scripts/.pack-key.pem}"
CHROME="${CHROME_BIN:-google-chrome-stable}"

mkdir -p "$(dirname "$OUT")"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

tar -C "$ROOT" \
  --exclude=node_modules --exclude=.git --exclude=dist --exclude=accept-shots \
  --exclude=scripts/.pack-key.pem --exclude='*.crx' --exclude='*.pem' \
  -cf - . | tar -C "$STAGE" -xf -

if [[ ! -f "$KEY" ]]; then
  echo "Generating pack key at $KEY (keep this file for stable extension id across releases)"
  openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out "$KEY"
fi

PACKED="$("$CHROME" --pack-extension="$STAGE" --pack-extension-key="$KEY" 2>&1)" || true
CRX_SRC="${STAGE}.crx"
if [[ ! -f "$CRX_SRC" ]]; then
  echo "$PACKED" >&2
  echo "pack failed: expected $CRX_SRC" >&2
  exit 1
fi
mv "$CRX_SRC" "$OUT"
rm -f "${STAGE}.pem"
echo "$OUT"
