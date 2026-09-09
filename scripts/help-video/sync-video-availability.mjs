#!/usr/bin/env node
/**
 * Regenerate src/content/help/video-availability.generated.ts from the assets
 * that actually ship in video/player.
 *
 * The help-video registry (src/content/help/video-assets.ts) lists every CRM
 * section, but only a handful are recorded. Without this manifest the launcher
 * renders a "Video dərslik" card everywhere, the <video> 404s, and the user
 * sees "Video hələ yüklənməyib" on ~90 sections that were never promised one.
 *
 * A slug/locale pair counts as available only when BOTH the voiced mp4 and its
 * poster exist — a half-copied asset must not advertise a card.
 *
 * Usage:  node scripts/help-video/sync-video-availability.mjs [--check]
 *   --check exits non-zero when the checked-in file is stale (CI/test gate).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const ASSET_DIR = join(ROOT, "video", "player")
const OUT_FILE = join(ROOT, "src", "content", "help", "video-availability.generated.ts")
const LOCALES = ["az", "en", "ru"]

export function collectAvailability(assetDir = ASSET_DIR) {
  let files
  try {
    files = new Set(readdirSync(assetDir))
  } catch {
    files = new Set()
  }

  /** @type {Record<string, string[]>} */
  const bySlug = {}
  for (const file of files) {
    const match = /^([a-z0-9-]+)\.(az|en|ru)\.VOICE\.mp4$/.exec(file)
    if (!match) continue

    const [, slug, locale] = match
    if (!files.has(`${slug}.${locale}.poster.jpg`)) continue

    ;(bySlug[slug] ??= []).push(locale)
  }

  return Object.fromEntries(
    Object.entries(bySlug)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([slug, locales]) => [slug, LOCALES.filter((l) => locales.includes(l))])
  )
}

function render(availability) {
  const entries = Object.entries(availability)
    .map(([slug, locales]) => `  "${slug}": [${locales.map((l) => `"${l}"`).join(", ")}],`)
    .join("\n")

  return `// GENERATED FILE — do not edit by hand.
// Run \`npm run help-video:sync\` after adding or removing files in video/player.
// Source of truth: the recorded assets themselves, so the help-video card is
// only offered for a section+locale that can actually play.
import type { HelpVideoLocale } from "./video-assets"

export const HELP_VIDEO_AVAILABILITY: Readonly<Record<string, readonly HelpVideoLocale[]>> = {
${entries}
}
`
}

function main() {
  const availability = collectAvailability()
  const next = render(availability)
  const check = process.argv.includes("--check")
  const slugs = Object.keys(availability)

  let current = ""
  try {
    current = readFileSync(OUT_FILE, "utf8")
  } catch {
    current = ""
  }

  if (current === next) {
    console.log(`help-video availability up to date (${slugs.length} slug(s))`)
    return
  }

  if (check) {
    console.error(
      "help-video availability manifest is stale — run `npm run help-video:sync` and commit the result"
    )
    process.exitCode = 1
    return
  }

  writeFileSync(OUT_FILE, next)
  console.log(`wrote ${OUT_FILE} (${slugs.length} slug(s): ${slugs.join(", ") || "none"})`)
}

// Importable from the test suite (which asserts the manifest matches disk), so
// only run the generator when invoked directly.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
