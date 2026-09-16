#!/bin/bash
# Build unpacked extension for DeepL A/B harness.
set -e
DEST=${DEST:-/tmp/pbt-ext}
SRC=${SRC:-/workspace}
rm -rf "$DEST" && mkdir -p "$DEST"
cd "$SRC"
cp -r manifest.json shared.js background.js content.js options.html options.js popup.html popup.js icons "$DEST"/
[ -f local-key.js ] && cp local-key.js "$DEST/" || true
if [ -n "${DEEPSEEK_API_KEY:-}" ] && [ ! -f "$DEST/local-key.js" ]; then
  printf 'const PBT_LOCAL_DEEPSEEK_KEY = "%s";\n' "$DEEPSEEK_API_KEY" > "$DEST/local-key.js"
fi
if [ -n "${DEEPL_API_KEY:-}" ]; then
  if [ -f "$DEST/local-key.js" ]; then
    printf '\nconst PBT_LOCAL_DEEPL_KEY = "%s";\n' "$DEEPL_API_KEY" >> "$DEST/local-key.js"
  else
    printf 'const PBT_LOCAL_DEEPL_KEY = "%s";\n' "$DEEPL_API_KEY" > "$DEST/local-key.js"
  fi
fi
node --check "$DEST"/background.js && node --check "$DEST"/content.js && echo "build-ok DEST=$DEST"
