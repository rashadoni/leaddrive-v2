import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const page = readFileSync("src/app/(dashboard)/settings/portal-users/page.tsx", "utf8")
const route = readFileSync("src/app/api/v1/portal-users/route.ts", "utf8")
const link = readFileSync("src/lib/portal-password-link.ts", "utf8")

describe("portal users UX contract", () => {
  it("debounces search, aborts stale requests and preserves existing rows while refreshing", () => {
    expect(page).toContain("setTimeout(() => setDebouncedSearch")
    expect(page).toContain("new AbortController")
    expect(page).toContain("controller.abort()")
    expect(page).toContain("setRefreshing(true)")
  })

  it("labels select-all and every row checkbox", () => {
    expect(page).toContain("portalSelectAllVisible")
    expect(page).toContain("portalSelectUser")
    expect(page).toContain("indeterminate")
  })

  it("clears scoped selection when committed filters change and explains the scope", () => {
    expect(page).toContain("setSelected(new Set())")
    expect(page).toContain("portalSelectionScope")
    expect(page).toContain("sticky bottom-3")
    expect(page).toContain("scope.truncated")
  })

  it("uses a responsive card list through tablet widths and a compact wide-desktop table", () => {
    expect(page).toContain("xl:hidden")
    expect(page).toContain("hidden min-w-0 overflow-hidden rounded-lg border xl:block")
    expect(page).not.toContain("overflow-x-auto")
  })

  it("moves secondary actions into a labelled accessible menu", () => {
    expect(page).toContain("<DropdownMenu")
    expect(page).toContain("portalActionsFor")
    expect(page).toContain("min-h-11")
    expect(page).not.toMatch(/text-(blue|green|orange|purple|amber|red)-500/)
  })

  it("confirms single and bulk disable with credential and session impact", () => {
    expect(page).toContain("portalDisableImpact")
    expect(page).toContain("portalBulkDisableImpact")
    expect(page).toContain("<ConfirmDialog")
  })

  it("checks every mutation response and blocks duplicate actions", () => {
    expect(page).toContain("checkedResponse")
    expect(page).toContain("if (busyAction) return")
    expect(page).toContain("disabled={Boolean(busyAction)}")
  })

  it("shows recovery initiation, active expiry, expired state and failure", () => {
    for (const marker of ["portalPasswordLinkSentWithExpiry", "portalStateRecoveryActive", "portalStateRecoveryExpired", "portalRecoveryFailed"]) expect(page).toContain(marker)
    expect(link).toContain("expiresAt: expires.toISOString()")
  })

  it("reports audit success or failure truthfully with actor evidence", () => {
    expect(page).toContain("portalAuditRecorded")
    expect(page).toContain("portalAuditFailed")
    expect(route).toContain("actorUserId: auth.userId")
    expect(route).toContain("auditRecorded")
  })

  it("keeps the useful contacts CTA but removes duplicated header help copy", () => {
    expect(page).toContain("portalNoContactsAction")
    expect(page).not.toContain("hintPortalUsers")
    expect(page).not.toContain("ColorStatCard")
  })

  it("has loading, stable refresh, empty, filtered empty, error, permission and retry states", () => {
    for (const marker of ["initialLoading", "refreshing", "contacts.length === 0", "loadError", "portalPermissionDenied", "portalRetry"]) expect(page).toContain(marker)
  })

  it("avoids gradients, palette decoration and oversized headings", () => {
    expect(page).not.toMatch(/bg-gradient|from-(blue|violet|purple|emerald)|text-(3xl|4xl|5xl)/)
  })
})
