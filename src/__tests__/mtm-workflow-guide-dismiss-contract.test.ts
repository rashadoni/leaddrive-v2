import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * Field UX audit 2026-09-05, C5 tail: every screen showing the three-step
 * guide must let the reader put it away, and remember whose choice that was.
 *
 * Only «Визиты» did. The other four rendered the same panel with no dismiss
 * control at all — the panel that exists to teach once sat above the work
 * forever on four screens out of five.
 */
const CALL_SITES = [
  "src/app/(dashboard)/mtm/visits/page.tsx",
  "src/components/mtm/contact-explorer.tsx",
  "src/components/mtm/organization-explorer.tsx",
  "src/components/mtm/pharmacy-promotion-workspace.tsx",
]

function guideProps(source: string): string {
  const start = source.indexOf("<MtmWorkflowGuide")
  expect(start).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf("steps=", start))
}

describe("MTM workflow guide can be dismissed everywhere it appears", () => {
  it("every call site names the hint, the viewer and the control", () => {
    const incomplete: string[] = []
    for (const file of CALL_SITES) {
      const props = guideProps(readFileSync(file, "utf8"))
      for (const prop of ["dismissId=", "viewerKey=", "dismissLabel="]) {
        if (!props.includes(prop)) incomplete.push(`${file} → ${prop}`)
      }
    }
    expect(incomplete).toEqual([])
  })

  it("gives each screen its own hint id", () => {
    // A shared id would mean putting the guide away on contacts also hides it
    // on promotions — one dismissal the reader never made.
    const ids = CALL_SITES.map((file) => {
      const match = guideProps(readFileSync(file, "utf8")).match(/dismissId="([^"]+)"/)
      return match?.[1] ?? ""
    })
    expect(ids.filter(Boolean)).toHaveLength(CALL_SITES.length)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("derives the viewer from one place, not four copies", () => {
    for (const file of CALL_SITES.slice(1)) {
      const source = readFileSync(file, "utf8")
      expect(source).toContain("mtmViewerKey(")
      // The inline form is what this tail exists to stop spreading.
      expect(source).not.toContain("session?.user?.id ?? session?.user?.email")
    }
  })

  it("keeps the label in the dictionary the guide's own screens share", () => {
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      expect(messages.mtmCommon?.hintDismiss).toEqual(expect.any(String))
    }
  })
})
