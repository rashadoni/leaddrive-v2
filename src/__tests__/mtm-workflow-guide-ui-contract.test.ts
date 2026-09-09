import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/** Field UX audit 2026-09-05, task C5. */
describe("MTM workflow guide UI contract", () => {
  const guide = readFileSync("src/components/mtm/mtm-workflow-guide.tsx", "utf8")
  const visits = readFileSync("src/app/(dashboard)/mtm/visits/page.tsx", "utf8")

  it("can be dismissed, and remembers it per viewer", () => {
    expect(guide).toContain("mtmHintStorageKey(dismissId, viewerKey)")
    expect(guide).toContain('data-testid="mtm-workflow-guide-dismiss"')
    expect(guide).toContain("dismissMtmHint(")
  })

  it("stays visible for every screen that did not ask to be dismissible", () => {
    // Without dismissId the panel behaves exactly as before: no screen loses
    // its orientation guide because a prop was forgotten.
    expect(guide).toContain('const storageKey = dismissId ? mtmHintStorageKey(dismissId, viewerKey) : ""')
    expect(guide).toContain("{storageKey && dismissLabel ?")
  })

  it("is wired on the visits screen with a stable id", () => {
    expect(visits).toContain('dismissId="visits-clarity-guide"')
    expect(visits).toContain("viewerKey={viewerKey}")
  })
})
