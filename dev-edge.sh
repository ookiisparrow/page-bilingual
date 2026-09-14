#!/bin/bash
set -euo pipefail
PROFILE="/Users/sparrow/page-bilingual-edge-profile"
EXT="/Users/sparrow/page-bilingual"
EDGE="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
mkdir -p "$PROFILE"
exec "$EDGE" \
  --user-data-dir="$PROFILE" \
  --disable-extensions-except="$EXT" \
  --load-extension="$EXT" \
  --no-first-run \
  "https://en.wikipedia.org/wiki/Goal_setting"
