import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8")

describe("entitlement templates UX contract", () => {
  it("preserves tenant-scoped drafts across level and route changes and clears only after save or discard", () => {
    const page = source("src/app/(dashboard)/settings/entitlement-templates/page.tsx")
    expect(page).toContain("leaddrive:entitlement-template-draft:${orgId}:${level}")
    expect(page).toContain("parseStoredTemplateDraft")
    expect(page).toContain("window.sessionStorage.setItem(storageKey(orgId, activeLevel), JSON.stringify(draft))")
    expect(page).toContain("readStoredDraft(level) ?? saved")
    expect(page).toContain("window.sessionStorage.removeItem(storageKey(orgId, activeLevel))")
    expect(page).toContain("draftLevels.includes(level)")
    expect(page).toContain('data-draft={stored ? "true" : "false"}')
  })

  it("uses compact rows with one progressively disclosed editor and one sticky save bar", () => {
    const page = source("src/app/(dashboard)/settings/entitlement-templates/page.tsx")
    expect(page).toContain("expandedRuleKey")
    expect(page).toContain("<RuleEditor")
    expect(page.match(/onClick=\{saveTemplate\}/g)).toHaveLength(1)
    expect(page).toContain('className="sticky bottom-3')
    expect(page).not.toContain("pb-20")
    expect(page).not.toContain("<Card")
    expect(page).not.toContain('<main className="min-w-0 space-y-4">')
  })

  it("previews the resulting timeline and explains ordering before save", () => {
    const page = source("src/app/(dashboard)/settings/entitlement-templates/page.tsx")
    expect(page).toContain("function TemplatePreview")
    expect(page).toContain('t("previewBehavior")')
    expect(page).toContain('t("orderHint")')
    expect(page).toContain("dueWindowToSeconds")
    expect(page).toContain("left.seconds - right.seconds")
  })

  it("provides keyboard and touch-safe ordering plus named edit and delete controls", () => {
    const page = source("src/app/(dashboard)/settings/entitlement-templates/page.tsx")
    expect(page).toContain('aria-label={t("moveUpNamed"')
    expect(page).toContain('aria-label={t("moveDownNamed"')
    expect(page).toContain('aria-label={t("editRuleNamed"')
    expect(page).toContain('aria-label={t("deleteRuleNamed"')
    expect(page).toContain('className="h-11 w-11"')
    expect(page).toContain('role="switch" aria-checked={draft.isActive}')
    expect(page).toContain('role="switch" aria-checked={definition.isRequired}')
    expect(page).toContain('aria-label={t("templateActive")}')
    expect(page).toContain('className="sm:hidden">{draft.isActive ? t("active") : t("inactive")}')
    expect(page).not.toContain('type="checkbox"')
    expect(page).toContain('HelpButton slug="entitlements" className="h-11 w-11 shrink-0"')
    expect(page).toContain("ConfirmDialog")
  })

  it("localizes built-in names, levels, units, severities, and stable validation codes", () => {
    const page = source("src/app/(dashboard)/settings/entitlement-templates/page.tsx")
    const route = source("src/app/api/v1/entitlement-templates/route.ts")
    expect(page).toContain("DEFAULT_ENGLISH_TEMPLATE_NAMES")
    expect(page).toContain("DEFAULT_ENGLISH_RULE_NAMES")
    expect(page).toContain('te(`supportLevels.${template.supportLevel}`)')
    expect(page).toContain('te(`dueUnitsShort.${definition.dueUnit}`)')
    expect(route).toContain('code: "TEMPLATE_ACTIVE_EMPTY"')
    expect(route).toContain('code: duplicate ? "TEMPLATE_DUPLICATE" : "TEMPLATE_INVALID"')
  })

  it("covers loading, error, retry, empty-rule, read-only and save-recovery states", () => {
    const page = source("src/app/(dashboard)/settings/entitlement-templates/page.tsx")
    expect(page).toContain('aria-busy="true"')
    expect(page).toContain('role="alert"')
    expect(page).toContain('t("retry")')
    expect(page).toContain('t("emptyRules")')
    expect(page).toContain('t("readOnlyHint")')
    expect(page).toContain("payload.permissions")
    expect(page).toContain("catch (caught)")
  })

  it("stays responsive, reduced-motion friendly, and free of synthetic palette tropes", () => {
    const page = source("src/app/(dashboard)/settings/entitlement-templates/page.tsx")
    expect(page).toContain("grid-cols-2")
    expect(page).toContain("sm:grid-cols-4")
    expect(page).toContain("xl:grid-cols-")
    expect(page).toContain('className="flex min-w-0 flex-col gap-4"')
    expect(page).toContain('className="order-2 rounded-xl border bg-card p-3 sm:order-1 sm:p-4"')
    expect(page).toContain('className="order-1 rounded-xl border bg-card p-3 sm:order-2 sm:p-4"')
    expect(page).toContain('className="sr-only sm:not-sr-only"')
    expect(page).toContain('className="h-11 w-11 shrink-0 px-0 sm:w-auto sm:px-5"')
    expect(page).toContain("min-h-11")
    expect(page).toContain("focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2")
    expect(page).toContain("motion-reduce:transition-none")
    expect(page).toContain("motion-reduce:animate-none")
    expect(page).not.toMatch(/text-(?:2xl|3xl|4xl)/)
    expect(page).not.toMatch(/(?:violet|purple|cyan|fuchsia|green|amber|orange|blue|red|slate)-/)
    expect(page).not.toContain("bg-gradient")
  })
})
