import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

// Roadmap #19 Phase E. Multi-action endpoint extending the old
// `/api/v1/contacts/bulk-delete` (which stays as a backward-compat alias).
vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  },
  logAudit: vi.fn(),
}))

// Delete branch fires clearTaskRelationsMany (fire-and-forget task back-ref cleanup,
// queries prisma.task — absent from this entity-only prisma mock). Pre-existing gap,
// not the codemod; mock it so the delete happy-path validates auth + org-scoped delete.
vi.mock("@/lib/tasks/clear-task-relations", () => ({
  clearTaskRelationsMany: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { POST } from "@/app/api/v1/contacts/bulk/route"
import { prisma } from "@/lib/prisma"
import { mockAuthSequence } from "./helpers/bulk-auth"

const prismaMock = prisma as typeof prisma & {
  $executeRaw: ReturnType<typeof vi.fn>
}

function makeRequest(body: any) {
  return new Request("http://localhost/api/v1/contacts/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthSequence([{ role: "admin" }])
})

describe("POST /api/v1/contacts/bulk → action: delete", () => {
  it("re-checks contacts:delete permission separately", async () => {
    mockAuthSequence([{ role: "sales" }, { error: 403 }])
    const res = await POST(makeRequest({ ids: ["c1", "c2"], action: "delete" }))
    expect(res.status).toBe(403)
    expect(prisma.contact.deleteMany).not.toHaveBeenCalled()
  })

  it("deletes scoped by organizationId", async () => {
    mockAuthSequence([{ role: "admin" }, { role: "admin" }])
    const res = await POST(makeRequest({ ids: ["c1", "c2"], action: "delete" }))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.contact.deleteMany).mock.calls[0][0] as any
    expect(call.where).toEqual({ id: { in: ["c1", "c2"] }, organizationId: "org-1" })
  })
})

describe("POST /api/v1/contacts/bulk → action: update_category", () => {
  it("accepts each allowed category", async () => {
    for (const category of ["vip", "regular", "partner", "prospect", "inactive"]) {
      vi.clearAllMocks()
      mockAuthSequence([{ role: "admin" }])
      const res = await POST(makeRequest({ ids: ["c1"], action: "update_category", value: category }))
      expect(res.status).toBe(200)
      const call = vi.mocked(prisma.contact.updateMany).mock.calls[0][0] as any
      expect(call.data.category).toBe(category)
    }
  })

  it("rejects arbitrary category", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "update_category", value: "weird" }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/v1/contacts/bulk → action: update_source", () => {
  it("accepts each allowed source", async () => {
    for (const source of ["website", "referral", "cold_call", "sms", "email", "social", "event", "other"]) {
      vi.clearAllMocks()
      mockAuthSequence([{ role: "admin" }])
      const res = await POST(makeRequest({ ids: ["c1"], action: "update_source", value: source }))
      expect(res.status).toBe(200)
      const call = vi.mocked(prisma.contact.updateMany).mock.calls[0][0] as any
      expect(call.data.source).toBe(source)
    }
  })

  it("rejects arbitrary source", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "update_source", value: "spam" }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/v1/contacts/bulk → action: set_active", () => {
  it("sets isActive=true on value='true'", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "set_active", value: "true" }))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.contact.updateMany).mock.calls[0][0] as any
    expect(call.data.isActive).toBe(true)
  })

  it("sets isActive=false on value='false'", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "set_active", value: "false" }))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.contact.updateMany).mock.calls[0][0] as any
    expect(call.data.isActive).toBe(false)
  })

  it("rejects anything other than 'true' / 'false'", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "set_active", value: "1" }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/v1/contacts/bulk → action: add_tag", () => {
  it("runs idempotent array_append wrapped in array_remove (race-safe form)", async () => {
    const res = await POST(makeRequest({ ids: ["c1", "c2"], action: "add_tag", value: "vip-q4" }))
    expect(res.status).toBe(200)
    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce()
    const call = prismaMock.$executeRaw.mock.calls[0]
    const sql = (call[0] as TemplateStringsArray).join("?")
    // Architect P2: the atomic `array_append(array_remove(tags, X), X)`
    // pattern is race-safe under concurrent writes because both ops run
    // inside a single UPDATE expression which row-locks for the duration.
    // The earlier `NOT (X = ANY(tags))` guard had a check-then-write
    // race that could duplicate.
    expect(sql).toMatch(/array_append\s*\(\s*array_remove/i)
    expect(sql).not.toMatch(/NOT \(.+= ANY\(tags\)\)/)
  })

  it("rejects empty tag", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "add_tag", value: "   " }))
    expect(res.status).toBe(400)
  })

  it("rejects missing tag", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "add_tag" }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/v1/contacts/bulk → action: remove_tag", () => {
  it("runs array_remove SQL scoped by organizationId", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "remove_tag", value: "old" }))
    expect(res.status).toBe(200)
    const call = prismaMock.$executeRaw.mock.calls[0]
    const sql = (call[0] as TemplateStringsArray).join("?")
    expect(sql).toMatch(/array_remove/i)
    expect(sql).toMatch(/organizationId/)
  })

  it("rejects empty tag", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "remove_tag", value: "" }))
    expect(res.status).toBe(400)
  })
})

describe("POST /api/v1/contacts/bulk → validation", () => {
  it("rejects >100 ids", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `c${i}`)
    const res = await POST(makeRequest({ ids, action: "delete" }))
    expect(res.status).toBe(400)
  })

  it("rejects unknown action", async () => {
    const res = await POST(makeRequest({ ids: ["c1"], action: "burn" }))
    expect(res.status).toBe(400)
  })

  it("rejects empty ids array", async () => {
    const res = await POST(makeRequest({ ids: [], action: "delete" }))
    expect(res.status).toBe(400)
  })
})
