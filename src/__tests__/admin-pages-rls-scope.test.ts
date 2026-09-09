// Task 10 (T10d) — superadmin server pages RLS scoping, behavioral pin.
//
// Invokes the REAL admin page server components with the REAL rls-context
// module (AsyncLocalStorage) and a prisma mock that captures getRlsContext()
// AT QUERY TIME — the moment the RLS extension hook would fire in production.
// Pins two invariants per page:
//
//   • superadmin session → EVERY prisma call on the page runs under
//     { bypass: true } (cross-tenant by design; .run() form, server
//     components are not the HTTP-guard path)
//   • non-superadmin session → the page-level gate redirects BEFORE any
//     prisma call executes (the gate must precede the bypass scope — the
//     admin layout gate alone does not re-run on soft/partial RSC
//     navigations)
//
// Pages covered (every prisma-using page under src/app/admin):
//   /admin                    — dashboard counters + recent orgs (6 queries, one Promise.all)
//   /admin/plans              — planTemplate catalog (global table, classified uniformly)
//   /admin/tenants            — tenant directory findMany + count
//   /admin/tenants/[id]       — tenant detail findUnique (users relation + _count)
import { describe, it, expect, vi, beforeEach } from "vitest"
import { getRlsContext, type RlsContext } from "@/lib/rls-context"

/** ctx snapshots keyed by "<model>.<op>", captured when the mock query executes. */
const seen: Array<{ call: string; ctx: RlsContext | undefined }> = []
const cap = (call: string) => seen.push({ call, ctx: getRlsContext() })
const ctxOf = (call: string) => seen.filter((s) => s.call === call).map((s) => s.ctx)

const { superAdminMock } = vi.hoisted(() => ({ superAdminMock: vi.fn() }))
vi.mock("@/lib/superadmin-guard", () => ({ isSuperAdminSession: superAdminMock }))

const orgRow = {
  id: "org1",
  name: "Acme",
  slug: "acme",
  plan: "pro",
  isActive: true,
  deletionScheduledAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  _count: { users: 2, contacts: 3, deals: 4, companies: 5 },
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      count: vi.fn(async () => { cap("organization.count"); return 7 }),
      findMany: vi.fn(async () => { cap("organization.findMany"); return [orgRow] }),
      findUnique: vi.fn(async () => {
        cap("organization.findUnique")
        return {
          ...orgRow,
          maxUsers: 5,
          maxContacts: 1000,
          serverType: "shared",
          provisionedAt: null,
          users: [],
          // Карточка API-ключей тенанта рендерится из этого же findUnique
          // (суперадмин смотрит scope'ы, не заходя в CRM клиента).
          apiKeys: [],
          _count: { users: 2, contacts: 3, deals: 4, companies: 5, leads: 6 },
        }
      }),
    },
    user: { count: vi.fn(async () => { cap("user.count"); return 11 }) },
    contact: { count: vi.fn(async () => { cap("contact.count"); return 12 }) },
    deal: { count: vi.fn(async () => { cap("deal.count"); return 13 }) },
    planTemplate: { findMany: vi.fn(async () => { cap("planTemplate.findMany"); return [] }) },
  },
}))

// Server-only Next plumbing. redirect/notFound THROW like the real ones — the
// gate tests rely on execution stopping at the redirect.
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT") }),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
}))
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}))

// Client components — never executed by the RSC (JSX construction only), but
// stubbed so their browser-oriented module graphs stay out of the test.
vi.mock("@/app/admin/tenants/tenant-filters", () => ({ TenantFilters: () => null }))
vi.mock("@/app/admin/tenants/[id]/tenant-actions", () => ({ TenantActions: () => null }))
vi.mock("@/app/admin/tenants/[id]/tenant-admin-password-reset", () => ({ TenantAdminPasswordReset: () => null }))
vi.mock("@/app/admin/plans/plans-client", () => ({ default: () => null }))

beforeEach(() => {
  seen.length = 0
  superAdminMock.mockReset()
  superAdminMock.mockResolvedValue(true)
})

describe("/admin — dashboard", () => {
  it("superadmin: all six aggregate queries run under bypass", async () => {
    const { default: Page } = await import("@/app/admin/page")
    await Page()
    expect(ctxOf("organization.count")).toEqual([{ bypass: true }, { bypass: true }])
    expect(ctxOf("user.count")).toEqual([{ bypass: true }])
    expect(ctxOf("contact.count")).toEqual([{ bypass: true }])
    expect(ctxOf("deal.count")).toEqual([{ bypass: true }])
    expect(ctxOf("organization.findMany")).toEqual([{ bypass: true }])
  })

  it("non-superadmin: page-level gate redirects BEFORE any query", async () => {
    superAdminMock.mockResolvedValue(false)
    const { default: Page } = await import("@/app/admin/page")
    await expect(Page()).rejects.toThrow("NEXT_REDIRECT")
    expect(seen).toEqual([])
  })
})

describe("/admin/plans — plan catalog", () => {
  it("superadmin: planTemplate query runs under bypass", async () => {
    const { default: Page } = await import("@/app/admin/plans/page")
    await Page()
    expect(ctxOf("planTemplate.findMany")).toEqual([{ bypass: true }])
  })

  it("non-superadmin: gate redirects BEFORE any query", async () => {
    superAdminMock.mockResolvedValue(false)
    const { default: Page } = await import("@/app/admin/plans/page")
    await expect(Page()).rejects.toThrow("NEXT_REDIRECT")
    expect(seen).toEqual([])
  })
})

describe("/admin/tenants — tenant directory", () => {
  it("superadmin: findMany + count run under bypass", async () => {
    const { default: Page } = await import("@/app/admin/tenants/page")
    await Page({ searchParams: Promise.resolve({}) })
    expect(ctxOf("organization.findMany")).toEqual([{ bypass: true }])
    expect(ctxOf("organization.count")).toEqual([{ bypass: true }])
  })

  it("non-superadmin: page-level gate redirects BEFORE any query", async () => {
    superAdminMock.mockResolvedValue(false)
    const { default: Page } = await import("@/app/admin/tenants/page")
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_REDIRECT")
    expect(seen).toEqual([])
  })
})

describe("/admin/tenants/[id] — tenant detail", () => {
  it("superadmin: findUnique (users relation + _count) runs under bypass", async () => {
    const { default: Page } = await import("@/app/admin/tenants/[id]/page")
    await Page({ params: Promise.resolve({ id: "org1" }) })
    expect(ctxOf("organization.findUnique")).toEqual([{ bypass: true }])
  })

  it("non-superadmin: page-level gate redirects BEFORE any query", async () => {
    superAdminMock.mockResolvedValue(false)
    const { default: Page } = await import("@/app/admin/tenants/[id]/page")
    await expect(Page({ params: Promise.resolve({ id: "org1" }) })).rejects.toThrow("NEXT_REDIRECT")
    expect(seen).toEqual([])
  })
})
