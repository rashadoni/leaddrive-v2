/**
 * Outside reviewer under NDA: what the gate lets through, how the end date is
 * read, and that the permission matrix cannot be widened by a route naming a
 * module. These rules are the whole promise to the owner ("only reads, only the
 * ticked sections, nothing after the date"), so each is pinned by behaviour.
 */
import { describe, expect, it } from "vitest"
import { checkPermission } from "@/lib/permissions"
import {
  describeReviewerRead,
  reviewerAccessOpen,
  reviewerHiddenModules,
  reviewerMaxExpiry,
  reviewerRequestDenial,
  reviewerUploadScope,
} from "@/lib/reviewer-access"

const NOW = Date.parse("2026-10-23T12:00:00Z")
const OPEN_UNTIL = "2026-10-30T20:59:59.000Z"

function denial(pathname: string, method = "GET", accessUntil: string | null = OPEN_UNTIL) {
  return reviewerRequestDenial({ pathname, method, accessUntil, now: NOW })
}

describe("reviewerRequestDenial", () => {
  it("lets ordinary reads through to the usual module checks", () => {
    for (const path of [
      "/dashboard", "/contacts", "/contacts/abc123def",
      "/api/v1/contacts", "/api/v1/contacts/cmabc123xyz", "/api/v1/deals?stage=won",
      "/api/v1/users/me", "/api/v1/users/assignable", "/api/v1/notifications",
      "/uploads/contracts/a1b2c3.pdf",
    ]) {
      expect(denial(path.split("?")[0]), path).toBeNull()
    }
  })

  it("refuses every write, whatever the path", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(denial("/api/v1/contacts", method)).toBe("forbidden")
      expect(denial("/api/v1/users/me", method)).toBe("forbidden")
    }
  })

  it("keeps signing out possible", () => {
    expect(denial("/api/auth/signout", "POST")).toBeNull()
  })

  it("closes settings, users, the journal, admin and its own panel", () => {
    for (const path of [
      "/api/v1/settings/roles", "/api/v1/users", "/api/v1/users/cmuser1234",
      "/api/v1/audit-log", "/api/v1/admin/tenants", "/api/v1/api-keys",
      "/api/v1/reviewer-access", "/api/v1/reviewer-access/x/journal",
      "/settings", "/settings/users", "/admin/tenants",
    ]) {
      expect(denial(path), path).toBe("forbidden")
    }
  })

  it("closes every export, whichever way it is spelled", () => {
    for (const path of [
      "/api/v1/tasks/export", "/api/v1/contracts/export", "/api/v1/complaints/export-xlsx",
      "/api/v1/foia-export", "/api/v1/mtm/excel/exports/visits", "/api/v1/surveys/s1/export",
      "/api/finance/dashboard/export",
    ]) {
      expect(denial(path), path).toBe("forbidden")
    }
    // A word that merely contains "export" is not an export.
    expect(denial("/api/v1/exporters")).toBeNull()
  })

  it("ends everything at the end date, and without one", () => {
    expect(denial("/api/v1/contacts", "GET", "2026-10-23T11:59:59.000Z")).toBe("expired")
    expect(denial("/contacts", "GET", null)).toBe("expired")
    expect(denial("/contacts", "GET", "not a date")).toBe("expired")
  })
})

describe("checkPermission for a reviewer", () => {
  it("reads business sections and nothing administrative", () => {
    expect(checkPermission("reviewer", "contacts", "read")).toBe(true)
    expect(checkPermission("reviewer", "finance", "read")).toBe(true)
    for (const scope of ["settings", "users", "audit", "social-legal"]) {
      expect(checkPermission("reviewer", scope, "read"), scope).toBe(false)
    }
  })

  it("never writes, deletes, exports or administers", () => {
    for (const action of ["write", "delete", "export", "admin"] as const) {
      expect(checkPermission("reviewer", "contacts", action), action).toBe(false)
    }
  })
})

describe("grant helpers", () => {
  it("is open only before the end date and while not revoked", () => {
    const now = new Date(NOW)
    expect(reviewerAccessOpen({ expiresAt: OPEN_UNTIL }, now)).toBe(true)
    expect(reviewerAccessOpen({ expiresAt: OPEN_UNTIL, revokedAt: new Date(NOW - 1) }, now)).toBe(false)
    expect(reviewerAccessOpen({ expiresAt: new Date(NOW) }, now)).toBe(false)
    expect(reviewerAccessOpen(null, now)).toBe(false)
  })

  it("hides every section that was not ticked", () => {
    expect(reviewerHiddenModules(["crm", "sales", "finance", "mtm"], ["crm", "mtm"])).toEqual(["sales", "finance"])
  })

  it("caps the end date at 30 days", () => {
    expect(reviewerMaxExpiry(new Date(NOW)).toISOString()).toBe("2026-11-22T12:00:00.000Z")
  })

  it("names the section behind an uploaded file", () => {
    expect(reviewerUploadScope("/uploads/mtm-photos/x.jpg")).toBe("mtm")
    expect(reviewerUploadScope("/uploads/inbox/org/x.pdf")).toBe("inbox")
    expect(reviewerUploadScope("/uploads/logos/logo.png")).toBeNull()
  })

  it("tells a list from a record and a file in the journal", () => {
    expect(describeReviewerRead("/api/v1/contacts")).toEqual({ scope: "contacts", kind: "list", recordId: null })
    expect(describeReviewerRead("/api/v1/contacts/cmabc123xyz")).toEqual({ scope: "contacts", kind: "record", recordId: "cmabc123xyz" })
    expect(describeReviewerRead("/api/v1/contacts/summary")).toMatchObject({ kind: "list", recordId: null })
    expect(describeReviewerRead("/api/v1/uploads/contracts/a1b2.pdf")).toMatchObject({ scope: "contracts", kind: "file" })
  })
})
