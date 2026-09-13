import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8")

describe("agent desktop UX contract", () => {
  it("has no fabricated dashboard metrics or decorative gauge palette", () => {
    const page = source("src/app/(dashboard)/support/agent-desktop/page.tsx")
    expect(page).not.toContain("Math.random")
    expect(page).not.toContain("2h 15m")
    expect(page).not.toContain("18h 30m")
    expect(page).not.toContain("CircularGauge")
    expect(page).not.toMatch(/bg-(?:blue|violet|green|amber)-500/)
    expect(page).not.toMatch(/text-(?:3xl|4xl)/)
  })

  it("puts next work and a keyboard-accessible responsive queue before analytics", () => {
    const page = source("src/app/(dashboard)/support/agent-desktop/page.tsx")
    expect(page.indexOf('aria-labelledby="next-ticket-heading"')).toBeLessThan(page.indexOf('aria-labelledby="metrics-heading"'))
    expect(page.indexOf('aria-labelledby="queue-heading"')).toBeLessThan(page.indexOf('aria-labelledby="metrics-heading"'))
    expect(page).toContain("md:hidden")
    expect(page).toContain("hidden overflow-x-auto md:block")
    expect(page).toContain("focus-visible:ring-2")
    expect(page).toContain("min-h-11")
    expect(page).not.toContain('className="min-h-9')
    expect(page).not.toContain('<summary className="min-h-10')
    expect(page).toContain('data-testid="agent-desktop-workspace"')
    expect(page).toContain('data-testid="agent-desktop-next-case"')
    expect(page).not.toContain("<main")
  })

  it("makes availability save, rollback truth and recovery explicit", () => {
    const page = source("src/app/(dashboard)/support/agent-desktop/page.tsx")
    expect(page).toContain("availabilitySaving")
    expect(page).toContain("availabilityUnchanged")
    expect(page).toContain("loadAvailability")
    expect(page).toContain("payload.data?.isAvailable !== nextValue")
    expect(page).toContain("aria-live=\"polite\"")
    expect(page).toContain('data-testid="agent-desktop-availability-saved"')
    expect(page).toContain('data-testid="agent-desktop-availability-error"')
  })

  it("keeps urgent states legible and metric definition markup valid", () => {
    const page = source("src/app/(dashboard)/support/agent-desktop/page.tsx")
    expect(page).toContain("bg-foreground text-background hover:bg-foreground/90")
    expect(page).toContain("font-semibold text-red-700 dark:text-red-300")
    expect(page).toContain('<dd className="mt-1">')
    expect(page).not.toContain('<p className="mt-1 text-xs text-muted-foreground">{t("sampleSize"')
    expect(page).not.toContain('<p className="sr-only">{metric.hint}</p>')
  })

  it("localizes every active queue priority and status", () => {
    const page = source("src/app/(dashboard)/support/agent-desktop/page.tsx")
    expect(page).toContain('["critical", "urgent", "high", "medium", "low"]')
    expect(page).toContain('"closed", "escalated"')
  })

  it("uses a tenant-scoped authoritative API contract and restricts team analytics", () => {
    const route = source("src/app/api/v1/support/agent-desktop/route.ts")
    expect(route).toContain('withRlsAuth("tickets", "read"')
    expect(route).toContain("assignedTo: auth.userId")
    expect(route).toContain('scope: "assigned_to_current_user"')
    expect(route).toContain("calculateAgentDesktopMetrics")
    expect(route).toContain("isManager(auth.role)")
  })
})
