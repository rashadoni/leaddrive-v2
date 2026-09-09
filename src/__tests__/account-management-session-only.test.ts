import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const guardState = vi.hoisted(() => ({ browserSession: false, role: "admin" }))

vi.mock("@/lib/api-auth", () => ({
  requireSessionAuth: vi.fn(async () => {
    if (!guardState.browserSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    return {
      orgId: "org-1",
      userId: "actor-1",
      role: guardState.role,
      email: "actor@example.com",
      name: "Actor",
    }
  }),
  // Deliberately over-privileged. These routes must never fall back to this
  // API-key/mobile-capable guard after browser-session authentication fails.
  requireAuth: vi.fn(async () => ({
    orgId: "org-1",
    userId: "automation-owner",
    role: "admin",
    email: "",
    name: "Synthetic privileged principal",
    scopes: ["write:settings", "write:users", "read:core", "write:core"],
  })),
  orgHasModule: vi.fn(async () => true),
  moduleDisabledResponse: vi.fn((moduleId: string) =>
    NextResponse.json({ error: "Forbidden", message: `Module "${moduleId}" is disabled` }, { status: 403 })),
  isAuthError: vi.fn((value: unknown) => value instanceof Response),
}))

vi.mock("@/lib/prisma", () => ({
  logAudit: vi.fn(async () => undefined),
  prisma: {
    user: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    apiKey: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    webhook: { updateMany: vi.fn() },
    $transaction: vi.fn(),
    // Модели, которые трогает передача незакрытой работы при обезличивании
    // пользователя (src/lib/user-work-handover.ts). Без них tx.deal.updateMany
    // — undefined, и падение выглядело бы как поломка авторизации.
    deal: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    lead: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    ticket: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    task: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    projectTask: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    project: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    division: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  },
}))

vi.mock("@/lib/plan-limits", () => ({
  checkUserLimit: vi.fn(async () => ({ allowed: true })),
}))

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn(async () => "hashed-password") },
}))

import { requireAuth, requireSessionAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { POST as createUser } from "@/app/api/v1/users/route"
import { PUT as updateUser, DELETE as deleteUser } from "@/app/api/v1/users/[id]/route"
import { POST as resetUserPassword } from "@/app/api/v1/users/[id]/reset-password/route"
import { GET as listKeys, POST as createKey } from "@/app/api/v1/api-keys/route"
import { PATCH as updateKey, DELETE as revokeKey } from "@/app/api/v1/api-keys/[id]/route"
import { GET as listScopes } from "@/app/api/v1/api-keys/scopes/route"

const userParams = { params: Promise.resolve({ id: "user-2" }) }
const keyParams = { params: Promise.resolve({ id: "key-1" }) }

function request(path: string, method = "GET", body?: Record<string, unknown>, authorization?: string) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function accountManagementAttempts(authorization?: string) {
  return [
    () => createUser(request("/api/v1/users", "POST", {
      name: "New User",
      email: "new.user@example.com",
      password: "Valid-Test-Pass-2026!",
    }, authorization)),
    () => updateUser(request("/api/v1/users/user-2", "PUT", { name: "Renamed" }, authorization), userParams),
    () => deleteUser(request("/api/v1/users/user-2", "DELETE", undefined, authorization), userParams),
    () => resetUserPassword(request("/api/v1/users/user-2/reset-password", "POST", {
      password: "Valid-Test-Pass-2026!",
      confirmPassword: "Valid-Test-Pass-2026!",
    }, authorization), userParams),
    () => listKeys(request("/api/v1/api-keys", "GET", undefined, authorization)),
    () => createKey(request("/api/v1/api-keys", "POST", {
      name: "Automation",
      scopes: ["read:contacts"],
    }, authorization)),
    () => updateKey(request("/api/v1/api-keys/key-1", "PATCH", { name: "Renamed key" }, authorization), keyParams),
    () => revokeKey(request("/api/v1/api-keys/key-1", "DELETE", undefined, authorization), keyParams),
    () => listScopes(request("/api/v1/api-keys/scopes", "GET", undefined, authorization)),
  ]
}

beforeEach(() => {
  guardState.browserSession = false
  guardState.role = "admin"
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
    const run = callback as unknown as (client: typeof prisma) => Promise<unknown>
    return await run(prisma) as never
  })
})

describe("account-security management is browser-session-only", () => {
  it.each([
    ["API key", "Bearer ld_privileged_automation_key"],
    ["mobile JWT", "Bearer mobile.synthetic.jwt"],
  ])("rejects a privileged %s before any management handler runs", async (_label, authorization) => {
    for (const attempt of accountManagementAttempts(authorization)) {
      const response = await attempt()
      expect(response.status).toBe(401)
    }

    expect(requireSessionAuth).toHaveBeenCalledTimes(accountManagementAttempts().length)
    expect(requireAuth).not.toHaveBeenCalled()
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(prisma.user.create).not.toHaveBeenCalled()
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(prisma.user.delete).not.toHaveBeenCalled()
    expect(prisma.apiKey.findMany).not.toHaveBeenCalled()
    expect(prisma.apiKey.findFirst).not.toHaveBeenCalled()
    expect(prisma.apiKey.create).not.toHaveBeenCalled()
    expect(prisma.apiKey.update).not.toHaveBeenCalled()
  })

  it("rejects an authenticated non-admin/non-settings role before touching data", async () => {
    guardState.browserSession = true
    guardState.role = "manager"

    for (const attempt of accountManagementAttempts()) {
      const response = await attempt()
      expect(response.status).toBe(403)
    }

    expect(prisma.user.findFirst).not.toHaveBeenCalled()
    expect(prisma.apiKey.findMany).not.toHaveBeenCalled()
    expect(prisma.apiKey.findFirst).not.toHaveBeenCalled()
  })

  it("allows a valid admin browser session across every management operation", async () => {
    guardState.browserSession = true
    guardState.role = "admin"

    const targetUser = {
      id: "user-2",
      organizationId: "org-1",
      name: "Target User",
      email: "target@example.com",
      role: "viewer",
      isActive: true,
      passwordChangedAt: null,
      anonymizedAt: null,
    }
    vi.mocked(prisma.user.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(targetUser as never)
      .mockResolvedValueOnce(targetUser as never)
      .mockResolvedValueOnce(targetUser as never)
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: "user-new",
      name: "New User",
      email: "new.user@example.com",
      role: "viewer",
      phone: null,
      department: null,
      isActive: true,
      createdAt: new Date(),
    } as never)
    vi.mocked(prisma.user.update).mockImplementation(async ({ data }) => ({
      ...targetUser,
      ...data,
    }) as never)
    // Оставлен намеренно: если удаление вернётся, ассерт ниже поймает это
    // не по отсутствию мока, а по самому факту вызова.
    vi.mocked(prisma.user.delete).mockResolvedValue(targetUser as never)

    vi.mocked(prisma.apiKey.findMany).mockResolvedValue([])
    vi.mocked(prisma.apiKey.create).mockResolvedValue({
      id: "key-new",
      name: "Automation",
      scopes: ["read:contacts"],
      expiresAt: null,
      createdAt: new Date(),
    } as never)
    vi.mocked(prisma.apiKey.findFirst)
      .mockResolvedValueOnce({ id: "key-1" } as never)
      .mockResolvedValueOnce({ id: "key-1" } as never)
    vi.mocked(prisma.apiKey.update).mockResolvedValue({
      id: "key-1",
      name: "Renamed key",
      isActive: true,
    } as never)
    vi.mocked(prisma.webhook.updateMany).mockResolvedValue({ count: 1 } as never)

    for (const attempt of accountManagementAttempts()) {
      const response = await attempt()
      expect(response.status).toBeGreaterThanOrEqual(200)
      expect(response.status).toBeLessThan(300)
    }

    expect(requireSessionAuth).toHaveBeenCalledTimes(accountManagementAttempts().length)
    expect(requireAuth).not.toHaveBeenCalled()
    expect(prisma.user.create).toHaveBeenCalledOnce()
    // Пользователь больше не удаляется физически: на него ссылаются четыре
    // таблицы под триггером «только добавление», и удаление отвергается
    // базой. Вместо этого строка обезличивается — см.
    // src/lib/user-anonymization.ts.
    expect(prisma.user.delete).not.toHaveBeenCalled()
    const anonymising = vi.mocked(prisma.user.update).mock.calls.filter(
      ([args]) => (args?.data as Record<string, unknown> | undefined)?.anonymizedAt,
    )
    expect(anonymising).toHaveLength(1)
    expect((anonymising[0][0].data as Record<string, unknown>).isActive).toBe(false)
    expect(prisma.apiKey.create).toHaveBeenCalledOnce()
    expect(prisma.apiKey.update).toHaveBeenCalledTimes(2)
  })
})
