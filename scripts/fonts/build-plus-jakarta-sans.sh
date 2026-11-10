#!/usr/bin/env bash
# Rebuilds src/lib/fonts/plus-jakarta-sans/PlusJakartaSans-wght.woff2 — the
# CRM's own font, served from the repository since 2026-11-10.
#
# Why it lives here: `next/font/google` downloaded the font from Google at build
# time, and on 2026-11-10 three deploy builds of main died in that download
# (Google handed the GitHub runner a font URL without a file extension, and
# next/font's loader read `null[1]`). A font in the repository cannot fail that
# way, and the build no longer needs Google at all.
#
# What it is: the same variable font Google Fonts serves (Plus Jakarta Sans
# 2.071, wght 200–800, from google/fonts at the pinned commit below), cut to
# exactly the characters Google's four subsets for this family carry together
# (latin, latin-ext — ə ş ğ ı ç ö ü of Azerbaijani —, vietnamese,
# cyrillic-ext; `codepoints.txt`) and with exactly the OpenType features
# Google keeps. One file instead of four: 38.7 KB, less than latin + latin-ext
# (27 + 22 KB) that every Azerbaijani page downloaded before.
#
# Run from the repository root:  bash scripts/fonts/build-plus-jakarta-sans.sh
# Needs python3 and network access; fonttools and brotli go into a temporary
# directory, not into the system.
set -euo pipefail

GOOGLE_FONTS_COMMIT="8cd7d0de182c88592d6852c245fe48f66eef55ee"
SOURCE_SHA256="89b3fb38aa0d275d7a731d0d817a4f1622b316b4d7fbdedcf02ee9099ff68bc8"
FEATURES="calt,ccmp,dnom,frac,liga,locl,numr,pnum,tnum,kern,mark"

root="$(git rev-parse --show-toplevel)"
dir="$root/src/lib/fonts/plus-jakarta-sans"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL -o "$work/source.ttf" \
  "https://raw.githubusercontent.com/google/fonts/$GOOGLE_FONTS_COMMIT/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf"
echo "$SOURCE_SHA256  $work/source.ttf" | sha256sum -c -

python3 -m pip install --quiet --target "$work/py" fonttools brotli
PYTHONPATH="$work/py" python3 -m fontTools.subset "$work/source.ttf" \
  --unicodes-file="$dir/codepoints.txt" \
  --layout-features="$FEATURES" \
  --no-hinting \
  --flavor=woff2 \
  --output-file="$dir/PlusJakartaSans-wght.woff2"

ls -l "$dir/PlusJakartaSans-wght.woff2"
sha256sum "$dir/PlusJakartaSans-wght.woff2"
