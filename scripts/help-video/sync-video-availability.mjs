#!/usr/bin/env node
/**
 * Regenerate src/content/help/video-availability.generated.ts from the master
 * set this release publishes — video/player/masters.sha256.
 *
 * The help-video registry (src/content/help/video-assets.ts) lists every CRM
 * section, but only a handful are recorded. Without this manifest the launcher
 * renders a "Video dərslik" card everywhere, the <video> 404s, and the user
 * sees "Video hələ yüklənməyib" on ~90 sections that were never promised one.
 *
 * A slug/locale pair counts as available only when BOTH the voiced mp4 and its
 * poster exist — a half-copied asset must not advertise a card.
 *
 * The bytes left the repository on 2026-11-02 (they ride in object storage, not
 * in the artifact), so the question "does this clip exist" is answered by the
 * committed manifest of the master set rather than by whatever happens to sit
 * in a working tree. That is the stronger source: the manifest is also what the
 * deploy pulls against, so a card is offered exactly when production will have
 * the file. A missing or malformed manifest THROWS — silently collecting
 * nothing would hide every help-video card on every section at once.
 *
 * Usage:  node scripts/help-video/sync-video-availability.mjs [--check]
 *   --check exits non-zero when the checked-in file is stale (CI/test gate).
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const MANIFEST_FILE = join(ROOT, "video", "player", "masters.sha256")
const OUT_FILE = join(ROOT, "src", "content", "help", "video-availability.generated.ts")
const LOCALES = ["az", "en", "ru"]

/** Names from a `sha256  name` manifest, as sha256sum writes it. */
export function manifestNames(manifestFile = MANIFEST_FILE) {
  const text = readFileSync(manifestFile, "utf8")
  const names = new Set()
  for (const line of text.split("\n")) {
    if (line === "") continue
    const match = /^([0-9a-f]{64})  ([a-z0-9-]+\.(?:az|en|ru)\.(?:VOICE\.mp4|poster\.jpg))$/.exec(line)
    if (!match) throw new Error(`${manifestFile}: cannot read line "${line}"`)
    names.add(match[2])
  }
  if (names.size === 0) throw new Error(`${manifestFile} lists no master files`)
  return names
}

export function collectAvailability(manifestFile = MANIFEST_FILE) {
  const files = manifestNames(manifestFile)

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
// Run \`npm run help-video:sync\` after changing video/player/masters.sha256.
// Source of truth: the published master set, so the help-video card is only
// offered for a section+locale production can actually play.
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

// Importable from the test suite (which asserts the generated file matches the
// master manifest), so only run the generator when invoked directly.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
