/**
 * The CRM's font, Plus Jakarta Sans, and where it comes from.
 *
 * The demo's scenes are in the CRM's own font (owner, 2026-10-20: the intro
 * clips are re-filmed so that they match the CRM). The CRM sets its pages in
 * Plus Jakarta Sans — `font-dashboard` on the dashboard's <main>. The clips had
 * been filmed in the body's Inter/Arial, which the filming box drew as
 * Liberation Sans.
 *
 * The font is served from the repository (`src/fonts/crm-font.ts`), not
 * downloaded from Google at build time: three production builds between
 * 2026-11-02 and 2026-11-04 failed on that download, and a failed build keeps
 * every merged fix off production.
 *
 * `next/font` runs only under Next's compiler, so what is checked is the
 * wiring, plus the font file itself: that it is a real WOFF2 whose character
 * map covers the Azerbaijani letters the UI is written in.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { brotliDecompressSync } from "node:zlib"
import { describe, expect, it } from "vitest"

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8")
const FONT_FILE = "src/fonts/plus-jakarta-sans/PlusJakartaSans-Variable.woff2"

/** Every source file under `dir`, tests excluded. */
function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(process.cwd(), dir)).flatMap((name) => {
    const rel = `${dir}/${name}`
    if (statSync(path.join(process.cwd(), rel)).isDirectory()) return rel === "src/__tests__" ? [] : sourceFiles(rel)
    return /\.(tsx?|jsx?|mjs|cjs)$/.test(name) ? [rel] : []
  })
}

/** The code points mapped by a WOFF2 font's `cmap` (formats 4 and 12 of the Windows Unicode subtables). */
function woff2CodePoints(bytes: Buffer): Set<number> {
  expect(bytes.toString("latin1", 0, 4)).toBe("wOF2")
  const numTables = bytes.readUInt16BE(12)
  const compressedSize = bytes.readUInt32BE(20)
  let at = 48
  const base128 = () => {
    let value = 0
    for (let i = 0; i < 5; i++) {
      const byte = bytes[at++]
      value = value * 128 + (byte & 0x7f)
      if (!(byte & 0x80)) return value
    }
    throw new Error("bad UIntBase128")
  }
  // Tables follow one another in the decompressed stream, in directory order.
  let offset = 0
  let cmap: { offset: number; length: number } | null = null
  for (let t = 0; t < numTables; t++) {
    const flags = bytes[at++]
    const tagIndex = flags & 0x3f
    if (tagIndex === 63) at += 4
    const transform = flags >> 6
    const origLength = base128()
    // glyf/loca (10/11) are transformed at version 0; every other table at a non-zero version.
    const transformed = tagIndex === 10 || tagIndex === 11 ? transform === 0 : transform !== 0
    const length = transformed ? base128() : origLength
    if (tagIndex === 0) cmap = { offset, length }
    offset += length
  }
  expect(cmap, "a cmap table").not.toBeNull()
  const stream = brotliDecompressSync(bytes.subarray(at, at + compressedSize))
  const table = stream.subarray(cmap!.offset, cmap!.offset + cmap!.length)

  const points = new Set<number>()
  const subtables = table.readUInt16BE(2)
  for (let s = 0; s < subtables; s++) {
    const platform = table.readUInt16BE(4 + s * 8)
    const sub = table.subarray(table.readUInt32BE(8 + s * 8))
    if (platform !== 3 && platform !== 0) continue
    const format = sub.readUInt16BE(0)
    if (format === 12) {
      const groups = sub.readUInt32BE(12)
      for (let g = 0; g < groups; g++) {
        const start = sub.readUInt32BE(16 + g * 12)
        const end = sub.readUInt32BE(20 + g * 12)
        for (let cp = start; cp <= end; cp++) points.add(cp)
      }
    } else if (format === 4) {
      const segments = sub.readUInt16BE(6) / 2
      const ends = 14
      const starts = ends + segments * 2 + 2
      const deltas = starts + segments * 2
      const rangeOffsets = deltas + segments * 2
      for (let i = 0; i < segments; i++) {
        const end = sub.readUInt16BE(ends + i * 2)
        const start = sub.readUInt16BE(starts + i * 2)
        const delta = sub.readInt16BE(deltas + i * 2)
        const rangeOffset = sub.readUInt16BE(rangeOffsets + i * 2)
        for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
          const glyph = rangeOffset === 0
            ? (cp + delta) & 0xffff
            : sub.readUInt16BE(rangeOffsets + i * 2 + rangeOffset + (cp - start) * 2)
          if (glyph !== 0) points.add(cp)
        }
      }
    }
  }
  return points
}

describe("the CRM's font is served from the repository", () => {
  it("is loaded once, by next/font/local, under the dashboard's variable", () => {
    const font = read("src/fonts/crm-font.ts")
    expect(font).toContain('import localFont from "next/font/local"')
    expect(font).toContain('src: "./plus-jakarta-sans/PlusJakartaSans-Variable.woff2"')
    expect(font).toContain('variable: "--font-dashboard"')
    // The Google call asked for 400, 500, 600 and 700.
    expect(font).toContain('weight: "400 700"')
  })

  it("never asks Google for a font at build time", () => {
    const offenders = sourceFiles("src").filter((file) => /["']next\/font\/google["']/.test(read(file)))
    expect(offenders).toEqual([])
  })

  it("ships the font with its licence", () => {
    expect(existsSync(path.join(process.cwd(), FONT_FILE))).toBe(true)
    expect(read("src/fonts/plus-jakarta-sans/OFL.txt")).toContain("SIL Open Font License, Version 1.1")
  })

  it("covers the Latin and the Azerbaijani letters the UI is written in", () => {
    const points = woff2CodePoints(readFileSync(path.join(process.cwd(), FONT_FILE)))
    const missing = [..."AZaz09 ƏəĞğIıİiŞşÇçÖöÜü€—«»"].filter((ch) => !points.has(ch.codePointAt(0)!))
    expect(missing).toEqual([])
    // Russian has never been in this font: `.font-dashboard` falls back to the system sans for it.
    expect(points.has("Ж".codePointAt(0)!)).toBe(false)
  })
})

describe("the demo's scenes are set in the CRM's font", () => {
  it("takes the dashboard's very font object", () => {
    expect(read("src/app/(dashboard)/layout.tsx")).toContain('import { crmFont } from "@/fonts/crm-font"')
    expect(read("src/app/(dashboard)/layout.tsx")).toContain("${crmFont.variable}")
    const demo = read("src/components/demo-center/journey/demo-scene-font.ts")
    expect(demo).toContain('import { crmFont } from "@/fonts/crm-font"')
    expect(demo).toContain("export const demoSceneFont = crmFont")
  })

  it.each(["demo-open", "demo-access", "demo-preview"])("defines the variable on /%s without a box of its own", (route) => {
    const layout = read(`src/app/${route}/layout.tsx`)
    expect(layout).toContain('from "@/components/demo-center/journey/demo-scene-font"')
    expect(layout).toContain("demoSceneFont.variable")
    // `contents`: the wrapper draws nothing, so the pages keep their own layout.
    expect(layout).toMatch(/className=\{`contents \$\{demoSceneFont\.variable\}`\}/)
  })

  it("puts the scene, and only the scene, in that font", () => {
    const player = read("src/components/demo-center/journey/demo-journey-player.tsx")
    expect(player).toMatch(/<main id="demo-scene" className="font-dashboard /)
    // The guide, the sidebar and the header around it keep the demo's own font.
    expect(player.match(/className=[^>]*\bfont-dashboard\b/g)).toHaveLength(1)
  })
})
