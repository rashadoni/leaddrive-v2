import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createMtmRouteCandidateCursor,
  MtmRouteCandidateCursorError,
  mtmRouteCandidateCursorBinding,
  readMtmRouteCandidateCursor,
} from "@/lib/mtm/route-candidate-cursor"

const originalSecret = process.env.NEXTAUTH_SECRET

function binding(overrides: Partial<Parameters<typeof mtmRouteCandidateCursorBinding>[0]> = {}) {
  return mtmRouteCandidateCursorBinding({
    organizationId: "org-1",
    userId: "user-1",
    principal: "web",
    authAgentId: null,
    actorRole: "MANAGER",
    actorAgentId: "agent-manager",
    scopedAgentIds: ["agent-2", "agent-1"],
    query: {
      agentId: "agent-1",
      direction: "ORGANIZATION",
      period: "5_DAYS",
      search: "",
      sort: "NAME",
      startDate: "2026-08-28",
    },
    ...overrides,
  })
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "mtm-route-candidate-cursor-test-secret"
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = originalSecret
})

describe("MTM route candidate keyset cursor", () => {
  it("encrypts a versioned tuple cursor and binds it to the authenticated scope and query", () => {
    const scopeBinding = binding()
    const cursor = createMtmRouteCandidateCursor({
      binding: scopeBinding,
      kind: "CUSTOMER",
      sort: "PRIORITY",
      values: { category: "A", name: "Araz", id: "customer-1" },
      now: 1_000,
    })

    expect(cursor).toMatch(/^v1:/)
    expect(cursor).not.toContain("customer-1")
    expect(readMtmRouteCandidateCursor({ token: cursor, binding: scopeBinding, now: 2_000 })).toEqual({
      schemaVersion: 1,
      kind: "CUSTOMER",
      sort: "PRIORITY",
      values: { category: "A", name: "Araz", id: "customer-1" },
    })
  })

  it("fails closed for plaintext, tampered, expired, and mismatched cursors", () => {
    const scopeBinding = binding()
    const cursor = createMtmRouteCandidateCursor({
      binding: scopeBinding,
      kind: "CONTACT",
      sort: "NAME",
      values: { name: "Doctor", id: "contact-1" },
      now: 1_000,
      ttlMs: 100,
    })
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("x") ? "y" : "x"}`

    expect(() => readMtmRouteCandidateCursor({ token: "legacy-plaintext", binding: scopeBinding, now: 1_050 }))
      .toThrow(MtmRouteCandidateCursorError)
    expect(() => readMtmRouteCandidateCursor({ token: tampered, binding: scopeBinding, now: 1_050 }))
      .toThrow(MtmRouteCandidateCursorError)
    expect(() => readMtmRouteCandidateCursor({ token: cursor, binding: scopeBinding, now: 1_100 }))
      .toThrow(MtmRouteCandidateCursorError)
    expect(() => readMtmRouteCandidateCursor({ token: cursor, binding: binding({ userId: "user-2" }), now: 1_050 }))
      .toThrow(MtmRouteCandidateCursorError)
  })

  it("normalizes scope ordering before it binds the cursor", () => {
    expect(binding()).toBe(binding({ scopedAgentIds: ["agent-1", "agent-2"] }))
  })
})
