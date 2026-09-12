import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const page = readFileSync("src/app/(dashboard)/support/ai-settings/page.tsx", "utf8")
const client = readFileSync("src/app/(dashboard)/support/ai-settings/support-ai-settings-client.tsx", "utf8")
const api = readFileSync("src/app/api/v1/support/ai-settings/route.ts", "utf8")
const settingsApi = readFileSync("src/app/api/v1/settings/ai-features/route.ts", "utf8")
const localized = ["en", "ru", "az"].map((locale) =>
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).supportAiSettings as Record<string, string>,
)

describe("Support AI settings UX contract", () => {
  it("uses the five compact operational consequence groups", () => {
    for (const key of ["tickets", "complaints", "portalChat", "whatsapp", "background"]) {
      expect(client).toContain(`key: "${key}"`)
    }
    expect(client).toContain("divide-y")
    expect(client).not.toContain("<Card")
  })

  it("distinguishes immediate from next-job effects before a material disable", () => {
    expect(client).toContain('timing: "immediate"')
    expect(client).toContain('timing: "nextJob"')
    expect(client).toContain("if (!nextEnabled) setConfirmDisable(true)")
    expect(client).toContain("<Dialog")
    expect(client).toContain('t("confirmImmediate")')
    expect(client).toContain('t("confirmNextJob")')
  })

  it("preserves server truth, rolls back failed mutation and exposes recovery", () => {
    expect(client).toContain("serverEnabled")
    expect(client).toContain("setSettings(previous)")
    expect(client).toContain("if (saving || !settings) return")
    expect(client).toContain("disabled={saving}")
    expect(client).toContain('t("retry")')
    expect(client).toContain("new AbortController")
  })

  it("has loading, audit-empty, error, success and permission states", () => {
    expect(client).toContain('aria-busy="true"')
    expect(client).toContain('t("auditEmpty")')
    expect(client).toContain('role="alert"')
    expect(client).toContain("toast.success")
    expect(page).toContain('redirect("/dashboard")')
    expect(client).toContain('data-testid="support-ai-settings-workspace"')
    expect(client).toContain('data-testid="support-ai-master-status"')
    expect(client).toContain('data-testid="support-ai-master-switch"')
    expect(client).toContain('data-testid="support-ai-confirm-disable"')
  })

  it("is responsive, keyboard/touch safe and reduced-motion aware", () => {
    expect(client).toContain("sm:grid-cols-")
    expect(client).toContain("lg:grid-cols-2")
    expect(client).toContain("min-h-11")
    expect(client).toContain("motion-reduce:animate-none")
    expect(client).toContain('aria-live="polite"')
    expect(client).toContain("aria-describedby")
  })

  it("uses neutral theme tokens without generic AI decoration or oversized type", () => {
    expect(client).not.toMatch(/bg-gradient|from-(blue|violet|purple|emerald)|text-(3xl|4xl|5xl)/)
    expect(client).not.toMatch(/(?:violet|purple|cyan|fuchsia|emerald|sky)-/)
  })

  it("returns actor, organization, before/after state and timestamp from persisted audit", () => {
    for (const marker of ["actor", "organization", "previousEnabled", "newEnabled", "changedAt"]) {
      expect(api).toContain(marker)
    }
    expect(settingsApi).toContain("oldValue: { supportAiEnabled:")
    expect(settingsApi).toContain("newValue: { supportAiEnabled:")
  })

  it("has complete operational copy in AZ, RU and EN", () => {
    const keys = [
      "ticketsTitle",
      "complaintsTitle",
      "portalChatTitle",
      "whatsappTitle",
      "backgroundTitle",
      "immediateLabel",
      "nextJobLabel",
      "manualDescription",
      "unaffectedDescription",
      "confirmDescription",
      "loadErrorTitle",
      "enabledLive",
      "disabledLive",
    ]
    for (const messages of localized) {
      for (const key of keys) expect(messages[key]?.trim().length, key).toBeGreaterThan(3)
    }
    expect(new Set(localized.map((messages) => messages.unaffectedDescription)).size).toBe(3)
  })
})
