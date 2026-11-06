# Plus Jakarta Sans

The CRM's font (`src/fonts/crm-font.ts`), served from the repository so that
`next build` does not download anything from Google.

- **Licence:** SIL Open Font License 1.1, `OFL.txt` next to this file.
  Copyright 2020 The Plus Jakarta Sans Project Authors
  (https://github.com/tokotype/PlusJakartaSans). The OFL allows bundling and
  redistributing the font with software; the file here is a subset under the
  same name, which the font has no Reserved Font Name to forbid.
- **Source:** `ofl/plusjakartasans/PlusJakartaSans[wght].ttf` in
  https://github.com/google/fonts, version 2.071, the same build that
  fonts.gstatic.com served (`plusjakartasans/v12`) on 2026-11-04.
- **What is in it:** the variable weight axis (200–800), the characters of the
  four slices Google served for this family — latin, latin-ext (Azerbaijani
  ə ğ ı ş ç ö ü), vietnamese, cyrillic-ext — and the layout features those
  slices kept. No Russian Cyrillic: the font has none, and `.font-dashboard`
  in `globals.css` falls back to the system sans for it, as before.

## Rebuilding it

```bash
pip install fonttools brotli
curl -sSLo PlusJakartaSans.ttf "https://github.com/google/fonts/raw/main/ofl/plusjakartasans/PlusJakartaSans%5Bwght%5D.ttf"
# The unicode ranges are those of the CSS Google serves for
# family=Plus+Jakarta+Sans:wght@400;500;600;700 to a current browser.
pyftsubset PlusJakartaSans.ttf \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD,U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C4,U+2113,U+2C60-2C7F,U+A720-A7FF,U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+1EA0-1EF9,U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F" \
  --layout-features=calt,ccmp,dnom,frac,liga,locl,numr,pnum,tnum,kern,mark,mkmk \
  --flavor=woff2 --output-file=PlusJakartaSans-Variable.woff2
```

`src/__tests__/demo-scene-font.test.ts` reads the file's character map and
fails if the Azerbaijani letters go missing.
