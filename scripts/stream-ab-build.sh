#!/bin/bash
# Build extension for stream A/B: VARIANT=baseline (1.4.62 non-stream) or current (1.4.63 stream).
set -e
DEST=${DEST:-/tmp/pbt-ext}
VARIANT=${VARIANT:-current}
BASE_REF=${BASE_REF:-origin/cursor/aggressive-speed-1.4.62-fd9b}
export DEST
rm -rf "$DEST" && mkdir -p "$DEST"
cd "${SRC:-/workspace}"
cp -r manifest.json shared.js options.html options.js popup.html popup.js icons "$DEST"/
if [ "$VARIANT" = "baseline" ]; then
  git show "${BASE_REF}:content.js" > "$DEST/content.js"
  git show "${BASE_REF}:background.js" > "$DEST/background.js"
  sed -i 's/"version": "1.4.63"/"version": "1.4.62"/' "$DEST/manifest.json"
else
  cp content.js background.js "$DEST/"
fi
[ -f local-key.js ] && cp local-key.js "$DEST/" || true
if [ -n "${DEEPSEEK_API_KEY:-}" ] && [ ! -f "$DEST/local-key.js" ]; then
  printf 'const PBT_LOCAL_DEEPSEEK_KEY = "%s";\n' "$DEEPSEEK_API_KEY" > "$DEST/local-key.js"
fi
node --check "$DEST"/background.js && node --check "$DEST"/content.js && echo "build-ok VARIANT=$VARIANT DEST=$DEST"
