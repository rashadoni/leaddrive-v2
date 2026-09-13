import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8")

describe("VoIP workspace UX contract", () => {
  it("loads rows and all summary metrics from one filtered server response", () => {
    const page = source("src/app/(dashboard)/support/voip/page.tsx")
    const route = source("src/app/api/v1/calls/route.ts")
    expect(page).toContain('period: "30d"')
    expect(page).toContain('summary: "1"')
    expect(page).toContain("payload.summary")
    expect(page).not.toContain("calls.filter")
    expect(route).toContain("Every summary query extends the exact same `where`")
    expect(route).toContain("averageDurationSeconds")
    expect(route).toContain("durationSample")
  })

  it("debounces search and aborts stale history requests", () => {
    const page = source("src/app/(dashboard)/support/voip/page.tsx")
    expect(page).toContain("window.setTimeout")
    expect(page).toContain("350")
    expect(page).toContain("new AbortController")
    expect(page).toContain("controller.abort()")
    expect(page).toContain('name !== "AbortError"')
  })

  it("provides desktop rows, tablet/mobile cards and non-color status text", () => {
    const page = source("src/app/(dashboard)/support/voip/page.tsx")
    expect(page).toContain("hidden overflow-x-auto lg:block")
    expect(page).toContain('className="divide-y lg:hidden"')
    expect(page).toContain("CallStatusBadge")
    expect(page).toContain("min-h-11")
    expect(page).not.toMatch(/text-(?:3xl|4xl)/)
    expect(page).not.toContain("text-[11px]")
    expect(page).not.toMatch(/text-(?:violet|purple|blue|green)-600/)
    expect(page).toContain('data-testid="voip-workspace"')
    expect(page).toContain('data-testid="voip-call-timeline"')
    expect(page).not.toContain("<main")
  })

  it("uses a native inline recording control with explicit lifecycle and recovery", () => {
    const player = source("src/components/voip/call-recording-player.tsx")
    expect(player).toContain("<audio")
    expect(player).toContain("controls")
    expect(player).toContain('preload="none"')
    expect(player).toContain("recordingUnavailable")
    expect(player).toContain("recordingLoading")
    expect(player).toContain("recordingError")
    expect(player).toContain("audio.load()")
    expect(player).toContain('data-testid="call-recording-player"')
    expect(player).toContain('data-testid="call-recording-retry"')
    expect(player).toContain('className="h-11 w-full max-w-full"')
  })

  it("keeps connection truth visible without exposing admin tests to agents", () => {
    const page = source("src/app/(dashboard)/support/voip/page.tsx")
    expect(page).toContain("canManageConnection = isAdmin(role)")
    expect(page).toContain("const refreshConnection = useCallback")
    expect(page).toContain("const testConnection = useCallback")
    expect(page).toContain('/api/v1/calls/providers')
    expect(page).toContain('/api/v1/calls/test')
    expect(page).toContain("canManageConnection ? testConnection() : refreshConnection()")
    expect(page).toContain("connectionAgentHint")
    expect(page).toContain("connectionAdminHint")
  })

  it("keeps the primary timeline compact and gates the lead queue by its modules", () => {
    const page = source("src/app/(dashboard)/support/voip/page.tsx")
    expect(page).toContain('grid grid-cols-3 sm:grid-cols-5')
    expect(page).toContain('hasModule({ plan: capabilityUser.plan || "", addons: capabilityUser.addons, modules: capabilityUser.modules }, "sales")')
    expect(page).toContain("{canViewMissedQueue && <MissedInboundQueue />}")
    expect(page).not.toContain('<p className="text-xs text-muted-foreground">{t("durationSample"')
  })

  it("gates callback and contact navigation actions by their actual permissions", () => {
    const page = source("src/app/(dashboard)/support/voip/page.tsx")
    expect(page).toContain('const permissionRole = (role || "viewer") as Role')
    expect(page).toContain('checkPermission(permissionRole, "voip", "write")')
    expect(page).toContain('checkPermission(permissionRole, "contacts", "read")')
    expect(page).toContain("safePhone && canCallBack")
    expect(page).toContain("call.contactId && canOpenContacts")
  })

  it("distinguishes load failure, empty results and filtered no-results with retry", () => {
    const page = source("src/app/(dashboard)/support/voip/page.tsx")
    expect(page).toContain("loadFailedTitle")
    expect(page).toContain("refreshFailed")
    expect(page).toContain("noMatchingCalls")
    expect(page).toContain("noCallsHint")
    expect(page).toContain("clearFilters")
  })
})
