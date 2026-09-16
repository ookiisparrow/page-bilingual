#!/bin/bash
# Build extension for A/B: VARIANT=baseline (1.4.61 @ 00c8795) or current (1.4.62).
set -e
DEST=${DEST:-/tmp/pbt-ext}
VARIANT=${VARIANT:-current}
export DEST
rm -rf "$DEST" && mkdir -p "$DEST"
cd "${SRC:-/workspace}"
cp -r manifest.json shared.js background.js options.html options.js popup.html popup.js icons "$DEST"/
if [ "$VARIANT" = "baseline" ]; then
  git show 00c8795:content.js > "$DEST/content.js"
  sed -i 's/"version": "1.4.61"/"version": "1.4.61-baseline"/' "$DEST/manifest.json"
else
  cp content.js "$DEST/content.js"
fi
[ -f local-key.js ] && cp local-key.js "$DEST/" || true
if [ -n "${DEEPSEEK_API_KEY:-}" ] && [ ! -f "$DEST/local-key.js" ]; then
  printf 'const PBT_LOCAL_DEEPSEEK_KEY = "%s";\n' "$DEEPSEEK_API_KEY" > "$DEST/local-key.js"
fi
node --check "$DEST"/background.js && node --check "$DEST"/content.js && echo "build-ok VARIANT=$VARIANT DEST=$DEST"
