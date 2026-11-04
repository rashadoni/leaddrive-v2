import localFont from "next/font/local"

/**
 * The CRM's own font, Plus Jakarta Sans, served from the repository.
 *
 * It used to come from `next/font/google`, which downloads the font from
 * fonts.googleapis.com / fonts.gstatic.com during `next build`. Three
 * production builds between 2026-11-02 and 2026-11-04 (70de34028, 672d64a6f,
 * 42f610bdd) died on that download (`TypeError: Cannot read properties of null
 * (reading '1')` in the Google loader), and a failed build is a fix that never
 * reaches production. The build now makes no font request at all.
 *
 * The file is the same font Google served, not a look-alike: Plus Jakarta Sans
 * 2.071 from google/fonts (`ofl/plusjakartasans/PlusJakartaSans[wght].ttf`),
 * cut to exactly the characters Google's four slices covered (latin,
 * latin-ext — Azerbaijani ə ğ ı ş ç ö ü —, vietnamese, cyrillic-ext) and the
 * layout features Google kept. How it was built is in
 * `plus-jakarta-sans/README.md`; the licence is `plus-jakarta-sans/OFL.txt`.
 *
 * One variable file for 400–700: the Google call asked for 400, 500, 600 and
 * 700, and a range of 400–700 resolves every requested weight (including
 * `font-light` and `font-extrabold`) to the same face it did before.
 *
 * The dashboard's <main> and the demo's scenes both take it from here
 * (`--font-dashboard`, read by `.font-dashboard` in `globals.css`).
 */
export const crmFont = localFont({
  src: "./plus-jakarta-sans/PlusJakartaSans-Variable.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-dashboard",
})
