import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

const dialog = source("src/components/ui/dialog.tsx")
const sharedDialogConsumers = [
  "src/components/lead-detail-modal.tsx",
  "src/components/journey-form.tsx",
  "src/components/workflow-actions-modal.tsx",
  "src/components/segment-form.tsx",
  "src/components/campaign-form.tsx",
  "src/app/(dashboard)/journeys/page.tsx",
].map(source)

describe("shared dialog close ownership", () => {
  it("provides one accessible, touch-sized corner close control", () => {
    expect(dialog.match(/<X\b/g)).toHaveLength(1)
    expect(dialog).toContain('aria-label={t("close")}')
    expect(dialog).toContain("h-11 w-11")
    expect(dialog).toContain('aria-hidden="true"')
  })

  it("does not add a second X close control in migrated dialog headers", () => {
    const duplicateClosePatterns = [
      /onClick=\{\(\) => onOpenChange\(false\)\}[\s\S]{0,240}<X\b/,
      /onClick=\{onClose\}[\s\S]{0,240}<X\b/,
      /onClick=\{\(\) => setStepsJourney\(null\)\}[\s\S]{0,240}<X\b/,
    ]

    for (const consumer of sharedDialogConsumers) {
      for (const pattern of duplicateClosePatterns) {
        expect(consumer).not.toMatch(pattern)
      }
    }
  })
})
