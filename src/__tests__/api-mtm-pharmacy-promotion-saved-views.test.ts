import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { AuthResult } from "@/lib/api-auth"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import {
  GET as listViews,
  POST as createView,
} from "@/app/api/v1/mtm/pharmacy-promotion-executions/views/route"
import {
  DELETE as deleteView,
  PATCH as updateView,
} from "@/app/api/v1/mtm/pharmacy-promotion-executions/views/[id]/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"

const ORG = "org-swissmed"
const USER = "user-manager"
const ENTITY_TYPE = "mtm_pharmacy_promotion_executions"
const AUTH: AuthResult = {
  orgId: ORG,
  userId: USER,
  role: "manager",
  email: "manager@swissmed.example",
  name: "Manager",
}

const createdAt = new Date("2026-08-01T08:00:00.000Z")
const updatedAt = new Date("2026-08-01T08:30:00.000Z")

function request(path: string, method = "GET", body?: unknown) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json", "user-agent": "vitest" },
          body: JSON.stringify(body),
        }),
  })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function savedView(overrides: Record<string, unknown> = {}) {
  return {
    id: "view-1",
    organizationId: ORG,
    userId: USER,
    name: "На проверку",
    filters: { sort: "createdAt", direction: "desc", page: 1, pageSize: 25 },
    isDefault: false,
    isShared: false,
    sortOrder: 0,
    createdAt,
    updatedAt,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(null)
  vi.mocked(resolveMobileAuth).mockResolvedValue(null)
  vi.mocked(requireAuth).mockResolvedValue(AUTH)
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as any)
  vi.mocked(prisma.savedView.findMany).mockResolvedValue([])
})

describe("SWM-09 pharmacy promotion saved views", () => {
  it("lists only private views owned by the current tenant user and preserves RU/AZ/EN labels", async () => {
    vi.mocked(prisma.savedView.findMany).mockResolvedValue([
      savedView({ id: "view-ru", name: "На проверку" }),
      savedView({ id: "view-az", name: "Təsdiq gözləyir" }),
      savedView({ id: "view-en", name: "Needs review" }),
      // A hostile/mock regression must not leak even if the database adapter
      // accidentally returns a row outside the requested owner predicate.
      savedView({ id: "view-other", userId: "another-user", name: "Private" }),
      savedView({ id: "view-other-org", organizationId: "org-other", name: "Other tenant" }),
      savedView({ id: "view-shared", isShared: true, name: "Shared" }),
      savedView({ id: "view-corrupt", name: "Corrupt", filters: { sort: "__proto__" } }),
    ] as any)

    const response = await listViews(request("/api/v1/mtm/pharmacy-promotion-executions/views"))

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(requireAuth).toHaveBeenCalledWith(expect.any(NextRequest), "mtm", "read")
    expect(prisma.savedView.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        userId: USER,
        entityType: ENTITY_TYPE,
        isShared: false,
      },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: expect.any(Object),
    })
    const payload = await response.json()
    expect(payload.data.views.map((view: { name: string }) => view.name)).toEqual([
      "На проверку",
      "Təsdiq gözləyir",
      "Needs review",
    ])
  })

  it("creates a private view with canonical registry filters and resets its page cursor", async () => {
    vi.mocked(prisma.savedView.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.savedView.create).mockImplementation(async (args: any) => savedView({
      id: "view-created",
      name: args.data.name,
      filters: args.data.filters,
      isDefault: args.data.isDefault,
      sortOrder: args.data.sortOrder,
    }) as any)

    const response = await createView(request(
      "/api/v1/mtm/pharmacy-promotion-executions/views",
      "POST",
      {
        name: "  На проверку  ",
        filters: {
          q: "  Central Pharmacy  ",
          executionStatus: "APPROVED",
          dateMode: "CONNECTED_AT",
          dateFrom: "2026-07-01",
          dateTo: "2026-07-31",
          amountMode: "DIFFERENCE",
          amountMin: "001.5000",
          amountMax: 25,
          sort: "pharmacy",
          direction: "asc",
          page: 7,
          pageSize: 50,
          columns: "pharmacy,employee,factPoints",
          density: "comfortable",
          view: "review",
        },
        isDefault: true,
        sortOrder: 4,
      },
    ))

    expect(response.status).toBe(201)
    expect(prisma.savedView.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: ORG,
        userId: USER,
        entityType: ENTITY_TYPE,
        isDefault: true,
      },
      data: { isDefault: false },
    })
    expect(prisma.savedView.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: ORG,
        userId: USER,
        entityType: ENTITY_TYPE,
        name: "На проверку",
        isShared: false,
        isDefault: true,
        sortOrder: 4,
        filters: expect.objectContaining({
          q: "Central Pharmacy",
          executionStatus: "APPROVED",
          dateMode: "CONNECTED_AT",
          dateFrom: "2026-07-01",
          dateTo: "2026-07-31",
          amountMode: "DIFFERENCE",
          amountMin: "1.5",
          amountMax: "25",
          sort: "pharmacy",
          direction: "asc",
          page: 1,
          pageSize: 50,
          columns: "pharmacy,employee,factPoints",
          density: "comfortable",
          view: "review",
        }),
      }),
    }))
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "PHARMACY_PROMOTION_VIEW_CREATE" }),
    })
  })

  it("rejects unsupported filter keys, invalid sort values, and unsupported page sizes", async () => {
    for (const filters of [
      { arbitrarySql: "ignored" },
      { sort: "drop-table" },
      { pageSize: 500 },
    ]) {
      const response = await createView(request(
        "/api/v1/mtm/pharmacy-promotion-executions/views",
        "POST",
        { name: "Invalid", filters },
      ))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: "MTM_PHARMACY_SAVED_VIEW_INVALID" })
    }
    const reversedRange = await createView(request(
      "/api/v1/mtm/pharmacy-promotion-executions/views",
      "POST",
      {
        name: "Invalid range",
        filters: {
          dateMode: "CREATED_AT",
          dateFrom: "2026-08-31",
          dateTo: "2026-08-01",
        },
      },
    ))
    expect(reversedRange.status).toBe(400)
    expect(await reversedRange.json()).toMatchObject({ code: "MTM_PHARMACY_FILTER_RANGE_INVALID" })
    expect(prisma.savedView.create).not.toHaveBeenCalled()
  })

  it("returns privacy-preserving 404 when another user's view is addressed", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValue(savedView({ userId: "other-user" }) as any)

    const response = await updateView(request(
      "/api/v1/mtm/pharmacy-promotion-executions/views/view-other",
      "PATCH",
      { name: "Changed" },
    ), params("view-other"))

    expect(response.status).toBe(404)
    expect(prisma.savedView.findFirst).toHaveBeenCalledWith({
      where: {
        id: "view-other",
        organizationId: ORG,
        userId: USER,
        entityType: ENTITY_TYPE,
        isShared: false,
      },
      select: expect.any(Object),
    })
    expect(prisma.savedView.updateMany).not.toHaveBeenCalled()
  })

  it("updates only the owned row, canonicalizes filters, and atomically moves the default", async () => {
    const existing = savedView({ id: "view-own", name: "Old" })
    const changed = savedView({
      id: "view-own",
      name: "Təsdiq gözləyir",
      isDefault: true,
      filters: { sort: "rewardPoints", direction: "desc", page: 1, pageSize: 100 },
    })
    vi.mocked(prisma.savedView.findFirst)
      .mockResolvedValueOnce(existing as any)
      .mockResolvedValueOnce(changed as any)
    vi.mocked(prisma.savedView.updateMany).mockResolvedValue({ count: 1 } as any)

    const response = await updateView(request(
      "/api/v1/mtm/pharmacy-promotion-executions/views/view-own",
      "PATCH",
      {
        name: "Təsdiq gözləyir",
        filters: { sort: "rewardPoints", direction: "desc", pageSize: 100 },
        isDefault: true,
      },
    ), params("view-own"))

    expect(response.status).toBe(200)
    expect(prisma.savedView.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        organizationId: ORG,
        userId: USER,
        entityType: ENTITY_TYPE,
        isDefault: true,
        NOT: { id: "view-own" },
      },
      data: { isDefault: false },
    })
    expect(prisma.savedView.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: "view-own",
        organizationId: ORG,
        userId: USER,
        entityType: ENTITY_TYPE,
        isShared: false,
      },
      data: expect.objectContaining({
        name: "Təsdiq gözləyir",
        filters: expect.objectContaining({
          sort: "rewardPoints",
          direction: "desc",
          page: 1,
          pageSize: 100,
        }),
        isDefault: true,
      }),
    })
  })

  it("deletes only an owned private view and hides cross-user deletes", async () => {
    vi.mocked(prisma.savedView.findFirst).mockResolvedValueOnce(
      savedView({ id: "view-other", userId: "other-user" }) as any,
    )
    const hidden = await deleteView(
      request("/api/v1/mtm/pharmacy-promotion-executions/views/view-other", "DELETE"),
      params("view-other"),
    )
    expect(hidden.status).toBe(404)
    expect(prisma.savedView.deleteMany).not.toHaveBeenCalled()

    vi.mocked(prisma.savedView.findFirst).mockResolvedValueOnce(
      savedView({ id: "view-own", name: "Needs review" }) as any,
    )
    vi.mocked(prisma.savedView.deleteMany).mockResolvedValue({ count: 1 } as any)
    const deleted = await deleteView(
      request("/api/v1/mtm/pharmacy-promotion-executions/views/view-own", "DELETE"),
      params("view-own"),
    )
    expect(deleted.status).toBe(200)
    expect(prisma.savedView.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "view-own",
        organizationId: ORG,
        userId: USER,
        entityType: ENTITY_TYPE,
        isShared: false,
      },
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "PHARMACY_PROMOTION_VIEW_DELETE" }),
    })
  })
})
