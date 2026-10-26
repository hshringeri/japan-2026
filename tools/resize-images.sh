#!/bin/sh
# Make the app's copies of the guide photos: 1280px on the long edge, JPEG quality 62.
# Originals in img/original/ are kept untouched for tools/check.py.
cd "$(dirname "$0")/.." || exit 1
for f in img/original/*.jpg; do
  sips -Z 1280 -s format jpeg -s formatOptions 62 "$f" --out "img/$(basename "$f")" >/dev/null
done
ls -la img/*.jpg
