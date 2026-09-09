/**
 * Tests for Phase 7 P0 #3 compliance-audit helper.
 *
 * Pure helper tests — the DB write is mocked. Validates:
 *   - Typed wrappers pass the right recordType to the core writer
 *   - NextRequest header extraction (IP from x-forwarded-for + x-real-ip
 *     fallback; user-agent capped at 500 chars)
 *   - Best-effort write swallows errors (returns null, doesn't throw)
 *
 * DB-integration tests for the append-only trigger are deferred —
 * project vitest is pure-helper only. Manual SQL smoke verifies that
 * UPDATE + DELETE both raise check_violation on the audit table.
 */
import { describe, expect, it, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"
import {
  ipFromRequest,
  userAgentFromRequest,
} from "@/lib/audit/compliance-audit"

/* ─── ipFromRequest ───────────────────────────────────────────────── */

function makeReq(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/test", { headers })
}

describe("compliance-audit — ipFromRequest", () => {
  it("returns null when no headers set", () => {
    expect(ipFromRequest(makeReq({}))).toBeNull()
  })

  it("returns first IP from x-forwarded-for CSV", () => {
    const req = makeReq({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" })
    expect(ipFromRequest(req)).toBe("1.2.3.4")
  })

  it("trims whitespace from x-forwarded-for entries", () => {
    const req = makeReq({ "x-forwarded-for": "  10.0.0.1  ,  10.0.0.2" })
    expect(ipFromRequest(req)).toBe("10.0.0.1")
  })

  it("falls back to x-real-ip when x-forwarded-for missing", () => {
    const req = makeReq({ "x-real-ip": "192.168.1.10" })
    expect(ipFromRequest(req)).toBe("192.168.1.10")
  })

  it("prefers x-forwarded-for over x-real-ip when both set", () => {
    const req = makeReq({
      "x-forwarded-for": "1.2.3.4",
      "x-real-ip": "5.6.7.8",
    })
    expect(ipFromRequest(req)).toBe("1.2.3.4")
  })

  it("returns null when x-forwarded-for is empty string", () => {
    const req = makeReq({ "x-forwarded-for": "" })
    expect(ipFromRequest(req)).toBeNull()
  })

  it("rejects spoofed x-forwarded-for with non-IP characters", () => {
    // Attacker tries to inject log-confusing text via untrusted proxy
    // header. Format sanity check (hex + dot + colon only) refuses it.
    const req = makeReq({ "x-forwarded-for": "DROP TABLE users;--" })
    expect(ipFromRequest(req)).toBeNull()
  })

  it("rejects oversized x-forwarded-for (>45 chars — beyond IPv6 max)", () => {
    const req = makeReq({ "x-forwarded-for": "1.2.3.4".repeat(20) })
    expect(ipFromRequest(req)).toBeNull()
  })

  it("rejects spoofed x-real-ip with non-IP characters", () => {
    const req = makeReq({ "x-real-ip": "evil@example.com" })
    expect(ipFromRequest(req)).toBeNull()
  })

  it("accepts valid IPv6 in x-forwarded-for", () => {
    const req = makeReq({ "x-forwarded-for": "2001:db8::1" })
    expect(ipFromRequest(req)).toBe("2001:db8::1")
  })
})

/* ─── userAgentFromRequest ────────────────────────────────────────── */

describe("compliance-audit — userAgentFromRequest", () => {
  it("returns null when no UA header", () => {
    expect(userAgentFromRequest(makeReq({}))).toBeNull()
  })

  it("returns the UA verbatim when under 500 chars", () => {
    const ua = "Mozilla/5.0 (Test) Chrome/100.0"
    expect(userAgentFromRequest(makeReq({ "user-agent": ua }))).toBe(ua)
  })

  it("caps UA at 500 chars (DB column is unbounded but we don't trust input)", () => {
    const longUa = "x".repeat(1000)
    const result = userAgentFromRequest(makeReq({ "user-agent": longUa }))
    expect(result).toHaveLength(500)
  })
})

/* ─── recordPhiAccess / recordPiiAccess / recordFoiaAccess — recordType injection ─── */

describe("compliance-audit — typed wrappers inject correct recordType", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("recordPhiAccess injects recordType='phi'", async () => {
    const calls: unknown[] = []
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        complianceAuditLog: {
          create: async (args: { data: Record<string, unknown> }) => {
            calls.push(args.data)
            return { id: "test-id-phi" }
          },
        },
      },
    }))
    const mod = await import("@/lib/audit/compliance-audit")
    const id = await mod.recordPhiAccess({
      organizationId: "org_1",
      userId: "user_1",
      action: "read",
      recordTable: "health_patients",
      recordId: "patient_1",
    })
    expect(id).toBe("test-id-phi")
    expect(calls).toHaveLength(1)
    expect((calls[0] as { recordType: string }).recordType).toBe("phi")
  })

  it("recordPiiAccess injects recordType='pii'", async () => {
    const calls: unknown[] = []
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        complianceAuditLog: {
          create: async (args: { data: Record<string, unknown> }) => {
            calls.push(args.data)
            return { id: "test-id-pii" }
          },
        },
      },
    }))
    const mod = await import("@/lib/audit/compliance-audit")
    await mod.recordPiiAccess({
      organizationId: "org_1",
      userId: "user_1",
      action: "read",
      recordTable: "policy_holders",
      recordId: "holder_1",
    })
    expect((calls[0] as { recordType: string }).recordType).toBe("pii")
  })

  it("recordFoiaAccess injects recordType='foia'", async () => {
    const calls: unknown[] = []
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        complianceAuditLog: {
          create: async (args: { data: Record<string, unknown> }) => {
            calls.push(args.data)
            return { id: "test-id-foia" }
          },
        },
      },
    }))
    const mod = await import("@/lib/audit/compliance-audit")
    await mod.recordFoiaAccess({
      organizationId: "org_1",
      userId: "user_1",
      action: "read",
      recordTable: "citizens",
      recordId: "citizen_1",
    })
    expect((calls[0] as { recordType: string }).recordType).toBe("foia")
  })

  it("best-effort write returns null on DB failure (does not throw)", async () => {
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        complianceAuditLog: {
          create: async () => {
            throw new Error("simulated DB error")
          },
        },
      },
    }))
    const mod = await import("@/lib/audit/compliance-audit")
    const id = await mod.recordPhiAccess({
      organizationId: "org_1",
      userId: "user_1",
      action: "read",
      recordTable: "health_patients",
      recordId: "patient_1",
    })
    expect(id).toBeNull()
  })

  it("metadata defaults to empty object when not provided", async () => {
    const calls: unknown[] = []
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        complianceAuditLog: {
          create: async (args: { data: Record<string, unknown> }) => {
            calls.push(args.data)
            return { id: "test-id-meta" }
          },
        },
      },
    }))
    const mod = await import("@/lib/audit/compliance-audit")
    await mod.recordPhiAccess({
      organizationId: "org_1",
      userId: "user_1",
      action: "read",
      recordTable: "health_patients",
    })
    expect((calls[0] as { metadata: object }).metadata).toEqual({})
  })

  it("recordId defaults to null for list-read scenarios", async () => {
    const calls: unknown[] = []
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        complianceAuditLog: {
          create: async (args: { data: Record<string, unknown> }) => {
            calls.push(args.data)
            return { id: "test-id-noid" }
          },
        },
      },
    }))
    const mod = await import("@/lib/audit/compliance-audit")
    await mod.recordPhiAccess({
      organizationId: "org_1",
      userId: "user_1",
      action: "read",
      recordTable: "health_patients",
      // no recordId — list/roster page
    })
    expect((calls[0] as { recordId: string | null }).recordId).toBeNull()
  })
})

/* ─── NextRequest packagers — the HTTP-route shortcut path ──────────── */

describe("compliance-audit — fromRequest packagers", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  function makeReqWithHeaders(headers: Record<string, string>): NextRequest {
    return new NextRequest("http://localhost/test", { headers })
  }

  it("recordPhiAccessFromRequest combines auth + req-headers correctly", async () => {
    const calls: unknown[] = []
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        complianceAuditLog: {
          create: async (args: { data: Record<string, unknown> }) => {
            calls.push(args.data)
            return { id: "test-id-phi-req" }
          },
        },
      },
    }))
    const mod = await import("@/lib/audit/compliance-audit")
    const req = makeReqWithHeaders({
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      "user-agent": "TestUA/1.0",
    })
    const id = await mod.recordPhiAccessFromRequest(
      req,
      { orgId: "org_x", userId: "user_y" },
      {
        recordTable: "health_patients",
        recordId: "patient_z",
        action: "read",
      },
    )
    expect(id).toBe("test-id-phi-req")
    const data = calls[0] as Record<string, unknown>
    expect(data.organizationId).toBe("org_x")
    expect(data.userId).toBe("user_y")
    expect(data.recordType).toBe("phi")
    expect(data.recordTable).toBe("health_patients")
    expect(data.recordId).toBe("patient_z")
    expect(data.action).toBe("read")
    expect(data.ipAddress).toBe("203.0.113.7")
    expect(data.userAgent).toBe("TestUA/1.0")
  })

  it("recordPiiAccessFromRequest injects 'pii' + defaults action to 'read'", async () => {
    const calls: unknown[] = []
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        complianceAuditLog: {
          create: async (args: { data: Record<string, unknown> }) => {
            calls.push(args.data)
            return { id: "test-id-pii-req" }
          },
        },
      },
    }))
    const mod = await import("@/lib/audit/compliance-audit")
    const req = makeReqWithHeaders({ "x-real-ip": "192.0.2.1" })
    await mod.recordPiiAccessFromRequest(
      req,
      { orgId: "org_a", userId: "user_b" },
      { recordTable: "policy_holders", recordId: "holder_c" },
      // action omitted — should default to "read"
    )
    const data = calls[0] as Record<string, unknown>
    expect(data.recordType).toBe("pii")
    expect(data.action).toBe("read")
    expect(data.ipAddress).toBe("192.0.2.1")
    expect(data.userAgent).toBeNull()
  })

  it("recordFoiaAccessFromRequest carries metadata + supports 'export' action", async () => {
    const calls: unknown[] = []
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        complianceAuditLog: {
          create: async (args: { data: Record<string, unknown> }) => {
            calls.push(args.data)
            return { id: "test-id-foia-req" }
          },
        },
      },
    }))
    const mod = await import("@/lib/audit/compliance-audit")
    const req = makeReqWithHeaders({})
    await mod.recordFoiaAccessFromRequest(
      req,
      { orgId: "org_z", userId: "user_w" },
      {
        recordTable: "citizens",
        recordId: "citizen_q",
        action: "export",
        metadata: { format: "csv", reason: "records-request" },
      },
    )
    const data = calls[0] as Record<string, unknown>
    expect(data.recordType).toBe("foia")
    expect(data.action).toBe("export")
    expect(data.metadata).toEqual({ format: "csv", reason: "records-request" })
    expect(data.ipAddress).toBeNull()
    expect(data.userAgent).toBeNull()
  })
})
