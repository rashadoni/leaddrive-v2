import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8")

describe("SLA policies UX contract", () => {
  it("uses one compact heading and a directly comparable responsive matrix", () => {
    const page = source("src/app/(dashboard)/settings/sla-policies/page.tsx")
    expect(page).toContain('aria-label={t("summaryLabel")}')
    expect(page).toContain('aria-label={t("matrixLabel")}')
    expect(page).toContain('className="hidden overflow-x-auto md:block"')
    expect(page).toContain('className="divide-y md:hidden"')
    expect(page).not.toContain("<Card")
    expect(page).not.toMatch(/text-(?:2xl|3xl|4xl)/)
  })

  it("localizes priorities and duration units instead of leaking raw values", () => {
    const page = source("src/app/(dashboard)/settings/sla-policies/page.tsx")
    const form = source("src/components/sla-policy-form.tsx")
    expect(page).toContain('t(`priority.${priority}`)')
    expect(page).toContain('t("durationHoursMinutes"')
    expect(form).toContain('t("hourUnit")')
    expect(form).toContain('t("minuteUnit")')
    expect(page).not.toContain("formatSlaHours")
    expect(form).not.toContain('placeholder="e.g.')
  })

  it("previews response, resolution, current clock behavior and escalation impact honestly", () => {
    const form = source("src/components/sla-policy-form.tsx")
    const en = JSON.parse(source("messages/en.json")).slaPolicyUi
    expect(form).toContain('t("responsePreview"')
    expect(form).toContain('t("resolutionPreview"')
    expect(form).toContain('t("businessClockPreview")')
    expect(form).toContain('t("escalationPreview")')
    expect(en.businessClockPreview).toContain("still advance continuously")
    expect(en.businessHoursOnlyHelp).toContain("until schedule-aware calculation is enabled")
  })

  it("blocks invalid target order and active priority conflicts on client and server", () => {
    const form = source("src/components/sla-policy-form.tsx")
    const createRoute = source("src/app/api/v1/sla-policies/route.ts")
    const updateRoute = source("src/app/api/v1/sla-policies/[id]/route.ts")
    expect(form).toContain("validateSlaTargets")
    expect(form).toContain("hasActivePriorityConflict")
    expect(createRoute).toContain('isolationLevel: "Serializable"')
    expect(updateRoute).toContain('isolationLevel: "Serializable"')
    expect(createRoute).toContain("ACTIVE_PRIORITY_CONFLICT")
    expect(updateRoute).toContain("targetError.toUpperCase()")
  })

  it("has named actions plus loading, empty, error, permission and retry states", () => {
    const page = source("src/app/(dashboard)/settings/sla-policies/page.tsx")
    expect(page).toContain("DropdownMenuTrigger")
    expect(page).toContain('aria-label={t("actionsNamed"')
    expect(page).toContain('aria-busy="true"')
    expect(page).toContain("motion-reduce:animate-none")
    expect(page).toContain("emptyTitle")
    expect(page).toContain("loadFailedTitle")
    expect(page).toContain("permissionDenied")
    expect(page).toContain("readOnlyHint")
    expect(page).toContain("fetchPolicies()")
  })

  it("is touch-safe and avoids generic decorative palette patterns", () => {
    const files = [
      source("src/app/(dashboard)/settings/sla-policies/page.tsx"),
      source("src/components/sla-policy-form.tsx"),
    ].join("\n")
    expect(files).toContain("min-h-11")
    expect(files).toContain("motion-reduce:animate-none")
    expect(files).not.toMatch(/(?:violet|purple|cyan|fuchsia)-/)
    expect(files).not.toContain("bg-gradient")
    expect(files).not.toContain("ColorStatCard")
  })
})
