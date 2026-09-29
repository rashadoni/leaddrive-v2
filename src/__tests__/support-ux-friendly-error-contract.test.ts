import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (file: string) => readFileSync(file, "utf8")

const customerFacingErrorSurfaces = [
  "src/app/(dashboard)/tickets/page.tsx",
  "src/app/(dashboard)/tickets/[id]/page.tsx",
  "src/app/(dashboard)/complaints/page.tsx",
  "src/app/(dashboard)/complaints/[id]/page.tsx",
  "src/app/(dashboard)/complaints/new/page.tsx",
  "src/app/(dashboard)/complaints/import/page.tsx",
  "src/app/(dashboard)/knowledge-base/page.tsx",
  "src/app/(dashboard)/knowledge-base/[id]/page.tsx",
  "src/app/(dashboard)/settings/macros/page.tsx",
  "src/app/(dashboard)/support/ai-settings/support-ai-settings-client.tsx",
  "src/app/portal/tickets/[id]/page.tsx",
  "src/components/convert-to-complaint-dialog.tsx",
  "src/components/kb-article-form.tsx",
  "src/components/voip/voice-calling-hours.tsx",
]

describe("Support UX friendly error contract", () => {
  it.each(customerFacingErrorSurfaces)("does not surface raw backend error strings from %s", (file) => {
    const source = read(file)
    expect(source).not.toMatch(/(?:json|payload|body)\??\.error\b\s*\|\|/)
    expect(source).not.toMatch(/new Error\((?:json|payload|body)\??\.error\b/)
    expect(source).not.toMatch(/\(body as \{ error\?: string \}\)\.error/)
  })

  it("keeps explicit recoverable error-key handling for known ticket conflicts", () => {
    const detail = read("src/app/(dashboard)/tickets/[id]/page.tsx")
    expect(detail).toContain('json?.errorKey === "ticketClosed"')
    expect(detail).toContain('json?.errorKey === "attachmentConflict"')
    expect(detail).toContain('json?.errorKey === "supportAiDisabled"')
  })
})
