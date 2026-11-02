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
    expect(page).toContain('data-testid="sla-policies-workspace"')
    expect(page).toContain("loadErrorRetryable")
    expect(page).toContain("actionErrorRetryable")
  })

  it("is touch-safe and avoids generic decorative palette patterns", () => {
    const page = source("src/app/(dashboard)/settings/sla-policies/page.tsx")
    const form = source("src/components/sla-policy-form.tsx")
    const button = source("src/components/ui/button.tsx")
    const appearance = source("src/app/crm-workspace.css")
    const files = [
      page,
      form,
      source("src/components/ui/dialog.tsx"),
    ].join("\n")
    expect(files).toContain("min-h-11")
    expect(files).toContain("motion-reduce:animate-none")
    expect(files).toContain("motion-reduce:transition-none")
    const create = page.match(/<Button data-testid="sla-policies-create"[\s\S]*?<\/Button>/)?.[0]
    const submit = form.match(/<Button data-testid="sla-policy-submit"[\s\S]*?<\/Button>/)?.[0]
    expect(create).toContain('className="min-h-11 px-4 sm:shrink-0"')
    expect(submit).toContain('className="min-h-11"')
    expect(create).not.toMatch(/\bvariant=/)
    expect(submit).not.toMatch(/\bvariant=/)
    expect(button).toContain('default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"')
    expect(button).toContain('data-crm-button={variant ?? "default"}')
    expect(appearance).toMatch(/\[data-crm-workspace\] \[data-crm-button="default"\]\s*\{\s*--primary: var\(--crm-action\);/)
    expect(files).toContain('className="absolute inset-0 h-full w-full cursor-pointer opacity-0"')
    expect(files).toContain("focus-within:ring-2")
    expect(files).not.toMatch(/(?:violet|purple|cyan|fuchsia)-/)
    expect(files).not.toContain("bg-gradient")
    expect(files).not.toContain("ColorStatCard")
  })

  it("keeps the shared primary and its translucent hover readable with white text", () => {
    const appearance = source("src/app/crm-workspace.css")
    const foregrounds = [...source("src/app/globals.css").matchAll(/--primary-foreground:\s*([^;]+);/g)]
    expect(foregrounds.length).toBeGreaterThan(0)
    for (const foreground of foregrounds) expect(foreground[1].trim()).toBe("0 0% 100%")

    const token = appearance.match(/--crm-action:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%;/)
    expect(token).not.toBeNull()
    const [hue, saturation, lightness] = token!.slice(1).map(Number)
    const s = saturation / 100
    const l = lightness / 100
    const a = s * Math.min(l, 1 - l)
    const rgb = [0, 8, 4].map((offset) => {
      const k = (offset + hue / 30) % 12
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    })
    // White is the brightest possible backdrop for the 90%-opacity hover.
    for (const opacity of [1, 0.9]) {
      const linear = rgb.map((value) => {
        const channel = value * opacity + 1 - opacity
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
      expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it("avoids a nested main landmark and exposes stable matrix/form states", () => {
    const page = source("src/app/(dashboard)/settings/sla-policies/page.tsx")
    const form = source("src/components/sla-policy-form.tsx")
    expect(page).not.toContain("<main")
    expect(page).toContain('data-testid="sla-policies-matrix"')
    expect(page).toContain('data-testid="sla-policies-mobile-list"')
    expect(page).toContain('data-testid="sla-policy-row"')
    expect(form).toContain('data-testid="sla-policy-form"')
    expect(form).toContain('data-testid="sla-policy-validation-error"')
    expect(form).toContain('data-testid="sla-policy-preview"')
  })
})
