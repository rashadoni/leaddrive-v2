import localFont from "next/font/local"

/**
 * The CRM's font, Plus Jakarta Sans, served from the repository.
 *
 * Until 2026-11-10 this was `Plus_Jakarta_Sans` from `next/font/google`, which
 * downloads the font from Google during `next build`. That day three deploy
 * builds of main died inside the download — Google gave the GitHub runner a
 * font URL without a file extension and next/font's loader threw
 * `Cannot read properties of null (reading '1')` — and every other session's
 * change waited hours for production. A file in the repository cannot fail that
 * way; the build no longer talks to Google at all.
 *
 * Nothing on screen changes:
 * - The file is Google's own font (Plus Jakarta Sans 2.071, variable wght)
 *   cut to the characters of all four subsets Google served (latin, latin-ext —
 *   ə ş ğ ı of Azerbaijani —, vietnamese, cyrillic-ext) with Google's
 *   OpenType features; every glyph's outline and advance at 400/500/600/700
 *   equals Google's. How to rebuild it: `scripts/fonts/build-plus-jakarta-sans.sh`.
 * - One file of 38.7 KB, preloaded, instead of latin (27 KB, preloaded) plus
 *   latin-ext (22 KB, fetched only after the first ə was laid out) — so an
 *   Azerbaijani page downloads less, and its ə no longer swaps in late.
 * - `400 700`: Google declared one face per weight, all on the same variable
 *   file; any Tailwind weight lands on the same instance either way (300 → 400,
 *   800 → 700).
 * - The fallback shown until the file arrives keeps Google's precalculated
 *   metrics (`Plus Jakarta Sans Fallback` in `globals.css`): next/font/local
 *   would measure the variable font's default ExtraLight instance and size
 *   Arial 0.8 % differently.
 *
 * One definition for the dashboard and the demo's scenes, so the two cannot
 * drift apart (`demo-scene-font.test.ts`).
 */
export const dashboardFont = localFont({
  src: [{ path: "./plus-jakarta-sans/PlusJakartaSans-wght.woff2", weight: "400 700", style: "normal" }],
  display: "swap",
  variable: "--font-dashboard",
  adjustFontFallback: false,
  // Одинарные кавычки, не двойные. Dev-сервер (Turbopack) вставляет запасной
  // шрифт в JS-строку `"'dashboardFont', …"` без экранирования: с двойными
  // кавычками модуль шрифта не разбирался («Expected ',', got 'ident'»), и
  // ни одна страница CRM в `next dev` не открывалась — так упала E2E очереди
  // мониторинга соцсетей 2026-11-10. Прод-сборка экранирует и работала с обоими.
  fallback: ["'Plus Jakarta Sans Fallback'"],
})
