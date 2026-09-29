import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8")

describe("escalation rules UX contract", () => {
  it("supports create, edit and safe inactive duplicate flows", () => {
    const page = source("src/app/(dashboard)/settings/escalation/page.tsx")
    expect(page).toContain('type FormMode = "create" | "edit" | "duplicate"')
    expect(page).toContain('openForm("edit", rule)')
    expect(page).toContain('openForm("duplicate", rule)')
    expect(page).toContain("next.isActive = false")
    expect(page).toContain('method: editing ? "PATCH" : "POST"')
  })

  it("renders localized sentence and deadline simulation with truthful L1-L5 behavior", () => {
    const page = source("src/app/(dashboard)/settings/escalation/page.tsx")
    expect(page).toContain("function RuleSentence")
    expect(page).toContain("triggerTimeFromDeadline")
    expect(page).toContain('type="datetime-local"')
    expect(page).toContain('t("orderBehavior")')
    expect(page).not.toContain("min)")
  })

  it("detects conflicts in the UI and blocks identical active rules at the API", () => {
    const page = source("src/app/(dashboard)/settings/escalation/page.tsx")
    const create = source("src/app/api/v1/escalation-rules/route.ts")
    const update = source("src/app/api/v1/escalation-rules/[id]/route.ts")
    expect(page).toContain("findEscalationConflict")
    expect(page).toContain("escalationConflictGroups")
    expect(create).toContain("ESCALATION_RULE_CONFLICT")
    expect(update).toContain("id: { not: id }")
  })

  it("uses semantic switches and named edit duplicate and delete controls with rollback feedback", () => {
    const page = source("src/app/(dashboard)/settings/escalation/page.tsx")
    expect(page).toContain("<Switch")
    expect(page).toContain('aria-live="polite"')
    expect(page).toContain("setRules(previous)")
    expect(page).toContain('aria-label={t("editNamed"')
    expect(page).toContain('aria-label={t("duplicateNamed"')
    expect(page).toContain('aria-label={t("deleteNamed"')
  })

  it("localizes actions targets and durations and explains destructive impact", () => {
    const page = source("src/app/(dashboard)/settings/escalation/page.tsx")
    expect(page).toContain('t(`targets.${draft.actionTarget}`)')
    expect(page).toContain('t(`duration.${draft.offsetUnit}`')
    expect(page).toContain('t("deleteDescription"')
    expect(page).not.toContain("a.target")
  })

  it("covers loading error retry empty permission filter-empty and conflict states", () => {
    const page = source("src/app/(dashboard)/settings/escalation/page.tsx")
    expect(page).toContain('aria-busy="true"')
    expect(page).toContain("loadFailedTitle")
    expect(page).toContain("permissionDenied")
    expect(page).toContain("rules.length === 0")
    expect(page).toContain("visibleRules.length === 0")
    expect(page).toContain("readOnlyHint")
    expect(page).toContain("conflictWarning")
  })

  it("stays compact touch-safe reduced-motion friendly and palette-neutral", () => {
    const page = source("src/app/(dashboard)/settings/escalation/page.tsx")
    expect(page).toContain("min-h-11")
    expect(page).toContain("motion-reduce:animate-none")
    expect(page).toContain('TourReplayButton tourId="escalationSettings" className="min-h-11 px-2"')
    expect(page).toContain('HelpButton slug="escalation" className="h-11 w-11 shrink-0"')
    expect(page).toContain('className="h-6 w-11"')
    expect(page).toContain('min-h-11 w-full shrink-0 sm:w-auto')
    expect(page).not.toMatch(/text-(?:2xl|3xl|4xl)/)
    expect(page).not.toMatch(/(?:violet|purple|cyan|fuchsia|green|amber|orange|blue|red|yellow)-/)
    expect(page).not.toContain("bg-gradient")
    expect(page).not.toContain("LEVEL_COLORS")
    expect(page).not.toContain("DataTable")
  })
})
