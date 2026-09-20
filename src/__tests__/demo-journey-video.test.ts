/**
 * Guide clips for a demo session.
 *
 * The capability-gated route reuses the help pipeline's filename pattern, so
 * these tests pin what a name may refer to (no traversal, no other locale,
 * no other extension) and what the demo is allowed to ask for at all.
 */
import { describe, expect, it } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { HELP_VIDEO_FILE_PATTERN, parseHelpVideoFile } from "@/lib/help-videos/serve"
import { PROSPECT_TO_CLOSED_WON, demoJourneyClipSlugs } from "@/lib/demo-center/journey"

const ROOT = process.cwd()
const ROUTE = "src/app/api/v1/public/demo-access/[token]/video/[file]/route.ts"

describe("Help-video filename contract", () => {
  it("accepts only <slug>.<locale>.VOICE.mp4 and .poster.jpg", () => {
    expect(parseHelpVideoFile("leads.az.VOICE.mp4")).toEqual({ slug: "leads", locale: "az", kind: "video" })
    expect(parseHelpVideoFile("deal-detail.ru.poster.jpg")).toEqual({ slug: "deal-detail", locale: "ru", kind: "poster" })
  })

  it("refuses traversal, absolute paths and anything outside the shape", () => {
    for (const bad of [
      "../../../etc/passwd",
      "..%2f..%2fetc%2fpasswd",
      "/etc/passwd",
      "leads.az.VOICE.mp4/../../secret",
      "leads/../deals.az.VOICE.mp4",
      "leads.az.VOICE.mp4.bak",
      "leads.de.VOICE.mp4",
      "leads.az.SOURCE.mp4",
      "LEADS.az.VOICE.mp4",
      "leads..az.VOICE.mp4",
      "",
    ]) {
      expect(HELP_VIDEO_FILE_PATTERN.test(bad), bad).toBe(false)
      expect(parseHelpVideoFile(bad), bad).toBeNull()
    }
  })
})

describe("Demo clip allowlist", () => {
  it("offers exactly the clips the approved scenario plays", () => {
    const slugs = demoJourneyClipSlugs()
    const expected = new Set(
      PROSPECT_TO_CLOSED_WON.sections.flatMap((section) => (section.intro ? [section.intro.slug] : [])),
    )
    expect([...slugs].sort()).toEqual([...expected].sort())
    expect(slugs.size).toBeGreaterThan(0)
  })

  it("never offers a clip the pipeline has no Azerbaijani file for", () => {
    for (const slug of demoJourneyClipSlugs()) {
      expect(existsSync(path.join(ROOT, "video/player", `${slug}.az.VOICE.mp4`)), slug).toBe(true)
    }
  })
})

describe("Demo video route", () => {
  const source = readFileSync(path.join(ROOT, ROUTE), "utf8")

  it("requires an active grant bound to this browser before streaming", () => {
    expect(source).toContain("validRawDemoToken")
    expect(source).toContain("expireDemoGrantIfNeeded")
    expect(source).toContain('grant.status !== "ACTIVE"')
    expect(source).toContain("secureHashMatches")
    expect(source).toContain("demoSessionCookieName")
  })

  it("restricts the clip to the allowlist, to Azerbaijani, and to what the pipeline will serve", () => {
    expect(source).toContain("demoJourneyClipSlugs()")
    expect(source).toContain('parsed.locale !== "az"')
    // The repository bans local-TTS voiceover; getHelpVideoForSlug is what
    // enforces it, so the demo may not bypass it with its own file check.
    expect(source).toContain("getHelpVideoForSlug")
  })

  it("keeps the token-bearing URL out of shared caches and search engines", () => {
    expect(source).toContain('"Cache-Control": "private, max-age=3600"')
    expect(source).toContain('"Referrer-Policy": "no-referrer"')
    expect(source).toContain("noindex")
  })

  it("does not leak whether a grant or a clip was the reason for a refusal", () => {
    // Every rejection path goes through one helper returning the same 404.
    expect(source.match(/return notFound\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(5)
    expect(source).not.toMatch(/status:\s*40[13]/)
  })
})
