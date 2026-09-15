#!/bin/bash
# Build test extension: VARIANT=baseline (1.4.59 bN from git) or remap (current §N§).
set -e
DEST=${DEST:-/tmp/pbt-ext}
VARIANT=${VARIANT:-remap}
export DEST
rm -rf "$DEST" && mkdir -p "$DEST"
cd "${SRC:-/workspace}"
cp -r manifest.json shared.js background.js options.html options.js popup.html popup.js icons "$DEST"/
if [ "$VARIANT" = "baseline" ]; then
  git show main:content.js > "$DEST/content.js"
  sed -i 's/"version": "1.4.59"/"version": "1.4.59-baseline"/' "$DEST/manifest.json"
else
  cp content.js "$DEST/content.js"
fi
node "/workspace/scripts/inject-stub.mjs" "$DEST/background.js"
node --check "$DEST"/background.js && node --check "$DEST"/content.js && echo "stub-ok VARIANT=$VARIANT DEST=$DEST"
