/**
 * The CRM's font comes from the repository, not from Google at build time.
 *
 * 2026-11-10: three deploy builds of main (ce52aaf4b, e31abb38c, e5634a0e4)
 * died in `next/font/google` — Google handed the GitHub runner a font URL
 * without a file extension and the loader threw
 * `Cannot read properties of null (reading '1')`. The font now lives in
 * `src/lib/fonts/plus-jakarta-sans/` (`src/lib/fonts/dashboard-font.ts`).
 *
 * What is pinned here is what would silently change the screen if it broke:
 * the Azerbaijani letters are in the file (they were in Google's latin-ext
 * subset, not latin), every character Google served is still there, and the
 * fallback shown before the file arrives has next/font/google's own metrics.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const read = (file: string) => readFileSync(path.join(root, file), "utf8")
const fontDir = "src/lib/fonts/plus-jakarta-sans"
const requireFromHere = createRequire(path.join(root, "package.json"))

type FontkitFont = { hasGlyphForCodePoint(codePoint: number): boolean; unitsPerEm: number; ascent: number; descent: number }
function openFont(): FontkitFont {
  let mod = requireFromHere("next/dist/compiled/@next/font/dist/fontkit").default
  mod = mod.default || mod
  return mod(readFileSync(path.join(root, fontDir, "PlusJakartaSans-wght.woff2")))
}

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`
    if (name === "__tests__" || name === "generated") return []
    if (statSync(path.join(root, rel)).isDirectory()) return sourceFiles(rel)
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [rel] : []
  })
}

describe("the CRM's font is served from the repository", () => {
  it("no application module asks Google for a font at build time", () => {
    const offenders = sourceFiles("src").filter((file) => /from\s+["']next\/font\/google["']/.test(read(file)))
    expect(offenders).toEqual([])
  })

  it("defines --font-dashboard from the file in the repository, with the fallback face from globals.css", () => {
    const module = read("src/lib/fonts/dashboard-font.ts")
    expect(module).toContain('import localFont from "next/font/local"')
    expect(module).toContain('path: "./plus-jakarta-sans/PlusJakartaSans-wght.woff2", weight: "400 700"')
    expect(module).toContain('variable: "--font-dashboard"')
    expect(module).toContain('display: "swap"')
    expect(module).toContain("adjustFontFallback: false")
    expect(module).toContain(`fallback: ["'Plus Jakarta Sans Fallback'"]`)
  })

  it("keeps double quotes out of the font names, or `next dev` cannot parse the font module", () => {
    // Turbopack generates `fontFamily: "'dashboardFont', <fallback…>"` — a
    // double-quoted JS string with the fallback list pasted in verbatim. On
    // 2026-11-10 `"Plus Jakarta Sans Fallback"` closed that string early:
    // `Expected ',', got 'ident'`, 500 on every dashboard page in dev and in
    // the dev-server E2E jobs, while the webpack production build was fine.
    const module = read("src/lib/fonts/dashboard-font.ts")
    const fallback = /fallback: \[([^\]]*)\]/.exec(module)
    expect(fallback, "the fallback list").not.toBeNull()
    for (const entry of fallback![1].split(",").map((part) => part.trim()).filter(Boolean)) {
      expect(entry.startsWith('"') && entry.endsWith('"'), `JS string literal ${entry}`).toBe(true)
      expect(entry.slice(1, -1), `font name inside ${entry}`).not.toContain('"')
    }
  })

  it("draws every Azerbaijani letter — and every character Google's four subsets carried", () => {
    const font = openFont()
    for (const letter of "ƏəŞşĞğIıİiÇçÖöÜü") {
      expect(font.hasGlyphForCodePoint(letter.codePointAt(0)!), `glyph for ${letter}`).toBe(true)
    }
    const google = read(`${fontDir}/codepoints.txt`).trim().split("\n")
    expect(google.length).toBe(605)
    const missing = google.filter((cp) => !font.hasGlyphForCodePoint(parseInt(cp.slice(2), 16)))
    expect(missing).toEqual([])
  })

  it("keeps Google's vertical metrics, so line boxes do not move", () => {
    const font = openFont()
    expect([font.unitsPerEm, font.ascent, font.descent]).toEqual([1000, 1038, -222])
  })

  it("sizes the fallback exactly as next/font/google did for this family", () => {
    const { getFallbackFontOverrideMetrics } = requireFromHere(
      "next/dist/compiled/@next/font/dist/google/get-fallback-font-override-metrics.js",
    )
    const google = getFallbackFontOverrideMetrics("Plus Jakarta Sans")
    const css = read("src/app/globals.css")
    const face = /@font-face \{\s*font-family: "Plus Jakarta Sans Fallback";([\s\S]*?)\}/.exec(css)
    expect(face, "the fallback @font-face in globals.css").not.toBeNull()
    const body = face![1]
    expect(body).toContain(`src: local("${google.fallbackFont}");`)
    expect(body).toContain(`ascent-override: ${google.ascentOverride};`)
    expect(body).toContain(`descent-override: ${google.descentOverride};`)
    expect(body).toContain(`line-gap-override: ${google.lineGapOverride};`)
    expect(body).toContain(`size-adjust: ${google.sizeAdjust};`)
  })

  it("ships the font's licence next to it", () => {
    expect(read(`${fontDir}/OFL.txt`)).toContain("SIL Open Font License, Version 1.1")
  })
})
