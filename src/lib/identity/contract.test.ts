import { describe, expect, it } from "vitest"
import { assertIdentityRequestId, assertIdentityScope, compareIdentityShadow, normalizeIdentityPhone, type IdentityShadowInput } from "./contract"

const base = (): IdentityShadowInput => ({ account: { version: 1 }, canonicalPhone: "+994550001122", userPhone: "+994 55 000 11 22", agentPhones: ["+994550001122"], grants: [] })

describe("one identity across independently granted applications", () => {
  it("normalizes explicit international presentation without guessing a country", () => {
    expect(normalizeIdentityPhone("00 994 (55) 000-11-22")).toBe("+994550001122")
    for (const value of ["0550001122", "994550001122", "+0001234567", "+994٥٥٠٠٠١١٢٢", "+994550001122x", "", null, "1".repeat(129)]) expect(normalizeIdentityPhone(value)).toBeNull()
  })
  it("does not expose a phone or infer grants from a legacy employee card", () => {
    const result = compareIdentityShadow(base())
    expect(result.status).toBe("CONSISTENT")
    expect(result.authenticationChanged).toBe(false)
    expect(result.applications.map(grant => grant.status)).toEqual(["NOT_GRANTED", "NOT_GRANTED", "NOT_GRANTED"])
    expect(JSON.stringify(result)).not.toContain("994")
  })
  it("allows the same person and phone to have Time and Route & Field independently", () => {
    const input = base()
    input.grants = [{ application: "TIME", status: "ACTIVE", role: "EMPLOYEE", version: 1 }, { application: "ROUTE_FIELD", status: "ACTIVE", role: "AGENT", version: 2 }]
    const result = compareIdentityShadow(input)
    expect(result.applications).toEqual([
      { application: "CRM", status: "NOT_GRANTED", role: null, version: 0 },
      { application: "TIME", status: "ACTIVE", role: "EMPLOYEE", version: 1 },
      { application: "ROUTE_FIELD", status: "ACTIVE", role: "AGENT", version: 2 },
    ])
    expect(result.authenticationChanged).toBe(false)
  })
  it("revoking one application preserves the other application's state and version", () => {
    const input = base()
    input.grants = [{ application: "TIME", status: "REVOKED", role: "EMPLOYEE", version: 3 }, { application: "ROUTE_FIELD", status: "ACTIVE", role: "MANAGER", version: 5 }]
    const result = compareIdentityShadow(input)
    expect(result.applications[1].status).toBe("REVOKED")
    expect(result.applications[2]).toEqual({ application: "ROUTE_FIELD", status: "ACTIVE", role: "MANAGER", version: 5 })
  })
  it("does not turn an unstaged account into an implicit legacy grant", () => {
    const input = base(); input.account = null; input.canonicalPhone = null
    const result = compareIdentityShadow(input)
    expect(result.status).toBe("UNSTAGED")
    expect(result.issues).toEqual(["ACCOUNT_NOT_STAGED", "VERIFIED_PHONE_MISSING"])
  })
  it("surfaces stale CRM/card phones instead of silently choosing either", () => {
    const input = base(); input.agentPhones = ["+994550009999"]
    expect(compareIdentityShadow(input).issues).toEqual(["LEGACY_PHONE_DISAGREEMENT", "CANONICAL_PHONE_DISAGREEMENT"])
  })
  it("requires explicit review of national formats and multiple legacy links", () => {
    const input = base(); input.agentPhones = ["0550001122", "+994550001122"]
    expect(compareIdentityShadow(input).issues).toEqual(["MULTIPLE_LEGACY_ACTORS", "LEGACY_PHONE_REVIEW_REQUIRED"])
  })
  it("rejects duplicate grants and an active grant without a role", () => {
    const input = base()
    input.grants = [{ application: "TIME", status: "ACTIVE", role: "EMPLOYEE", version: 1 }, { application: "TIME", status: "REVOKED", role: null, version: 2 }]
    expect(() => compareIdentityShadow(input)).toThrow("IDENTITY_GRANT_AMBIGUOUS")
    input.grants = [{ application: "TIME", status: "ACTIVE", role: " ", version: 1 }]
    expect(() => compareIdentityShadow(input)).toThrow("IDENTITY_GRANT_INVALID")
  })
  it("rejects absent, oversized and control-bearing tenant/subject/request keys", () => {
    for (const value of ["", " ", "tenant\n", "x".repeat(129)]) {
      expect(() => assertIdentityScope(value, "user-1")).toThrow("IDENTITY_SCOPE_INVALID")
      expect(() => assertIdentityRequestId(value)).toThrow("IDENTITY_REQUEST_INVALID")
    }
    expect(() => assertIdentityScope("tenant-1", "user-1")).not.toThrow()
    expect(() => assertIdentityRequestId("request:1")).not.toThrow()
  })
})
