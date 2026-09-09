/**
 * Help registry parity + render smoke.
 *
 * Backbone guarantee for the Help overhaul: every registered article has all
 * three locales (az/en/ru) present (title, subtitle, content), the content
 * files actually exist on disk, az resolves without falling back to en, and
 * every article (incl. orphans) renders to non-empty HTML without throwing.
 *
 * Node env + .ts file (no JSX → use createElement) so it fits the existing
 * vitest config without changes.
 */
import { describe, it, expect } from "vitest"
import fs from "fs"
import path from "path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { HELP_REGISTRY, resolveHelpArticle, type HelpSlug } from "@/content/help/registry"

const LOCALES = ["en", "ru", "az"] as const
const CONTENT_DIR = path.join(process.cwd(), "src/content/help")
// Every content dir must be registered — the Help rewrite wired all sections.
// `dashboard`/`finance` (pre-split dead content) were deleted; `pricing`/
// `subscriptions` are now live registered slugs. Allowlist is empty: zero orphans.
const ORPHAN_ALLOWLIST = new Set<string>([])

const slugs = Object.keys(HELP_REGISTRY) as HelpSlug[]

describe("help registry — locale parity", () => {
  it.each(slugs)("%s has title/subtitle/content for all 3 locales", (slug) => {
    const entry = HELP_REGISTRY[slug]
    for (const loc of LOCALES) {
      expect(entry.title[loc], `${slug}.title.${loc}`).toBeTruthy()
      expect(entry.subtitle[loc], `${slug}.subtitle.${loc}`).toBeTruthy()
      expect(entry.content[loc], `${slug}.content.${loc} (lazy import)`).toBeTruthy()
    }
  })

  it.each(slugs)("%s has all 3 content files on disk", (slug) => {
    for (const loc of LOCALES) {
      const f = path.join(CONTENT_DIR, slug, `${loc}.tsx`)
      expect(fs.existsSync(f), `missing ${f}`).toBe(true)
    }
  })

  it.each(slugs)("%s resolves az without en-fallback", (slug) => {
    // Registry-level: resolveHelpArticle picks az (not en). NB: this only
    // proves the lazy thunk is declared; the real az.tsx must exist+render —
    // that is enforced by the "renders" suite below (registry→file→HTML).
    const r = resolveHelpArticle(slug, "az")
    expect(r, `${slug} did not resolve`).not.toBeNull()
    expect(r!.locale, `${slug} az fell back to ${r!.locale}`).toBe("az")
  })

  it("no unregistered content directories (except allowlisted orphans)", () => {
    const dirs = fs
      .readdirSync(CONTENT_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    const registered = new Set(slugs as string[])
    const orphans = dirs.filter((d) => !registered.has(d) && !ORPHAN_ALLOWLIST.has(d))
    expect(orphans, `unregistered help dirs: ${orphans.join(", ")}`).toEqual([])
  })
})

// Render backbone — for EVERY registered slug × locale, the real content file
// must exist (in the glob), load, and render to non-empty HTML without throwing.
// Ties registry → on-disk file → rendered output per locale, so a missing or
// broken az.tsx (which the registry-level resolve can't catch) fails HERE.
// Articles import only pure layout primitives (no next-intl hooks), so
// renderToStaticMarkup works in node env.
// import.meta.glob is a Vite feature (vitest transforms it); cast so `tsc`
// (which doesn't load vite/client types here) doesn't complain.
const articleModules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>
  }
).glob("../content/help/*/*.tsx")

const slugLocalePairs = slugs.flatMap((slug) =>
  LOCALES.map((loc) => ({ slug, loc, key: `../content/help/${slug}/${loc}.tsx` })),
)

describe("help articles — registry→file→render (every slug × locale)", () => {
  it.each(slugLocalePairs)("$slug / $loc renders", async ({ key }) => {
    const loader = articleModules[key]
    expect(loader, `no module for ${key}`).toBeTruthy()
    const mod = (await loader()) as { default: React.ComponentType }
    expect(typeof mod.default, `${key} has no default export`).toBe("function")
    const html = renderToStaticMarkup(createElement(mod.default))
    expect(html.length, `${key} rendered empty`).toBeGreaterThan(0)
  })
})
