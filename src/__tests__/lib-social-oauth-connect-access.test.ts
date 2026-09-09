import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse, type NextRequest } from "next/server"

/**
 * withSocialConnectAuth — гейты общего OAuth-connect-флоу (2026-08-01, разделение
 * модулей omnichannel/social).
 *
 * Флоу используют ОБА модуля: инбокс подключает через него Messenger/IG DM с
 * /settings/channels, соцмониторинг — аккаунты для сбора упоминаний. Поэтому
 * `resolveModuleFromPath` оставляет /api/v1/social/oauth/** без модуля, а гейты
 * живут в хелпере. Тест фиксирует, что при этом НЕ ослабла авторизация:
 * сессия обязательна (иначе снятие модульного резолва отключило бы и проверку
 * scope'ов API-ключей), RBAC прежний, а модульный гейт пропускает любой из двух
 * модулей и не применяется к суперадмину (как и requireAuth).
 */
const deps = vi.hoisted(() => ({
  getSession: vi.fn(),
  orgHasModule: vi.fn(),
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (
    _module: unknown,
    _action: unknown,
    handler: (req: NextRequest, auth: unknown) => Promise<Response>,
  ) => (req: NextRequest, auth: unknown) => handler(req, auth),
}))
vi.mock("@/lib/api-auth", () => ({
  getSession: deps.getSession,
  orgHasModule: deps.orgHasModule,
  moduleDisabledResponse: (moduleId: string) =>
    NextResponse.json({ error: "Forbidden", message: `Module "${moduleId}" is not enabled.` }, { status: 403 }),
}))

import { withSocialConnectAuth } from "@/lib/social/oauth-access"

const req = () => ({}) as NextRequest
const ok = () => NextResponse.json({ ok: true })
const auth = (role: string) => ({ orgId: "org-1", userId: "u1", role, email: "a@b.c", name: "A" })

/** Модули, включённые у тенанта; всё остальное — выключено. */
function grant(...enabled: string[]) {
  deps.orgHasModule.mockImplementation(async (_orgId: string, moduleId: string) => enabled.includes(moduleId))
}

beforeEach(() => {
  vi.clearAllMocks()
  deps.getSession.mockResolvedValue(auth("admin"))
  grant("social", "omnichannel")
})

describe("withSocialConnectAuth", () => {
  it("401 без сессии — API-ключи и мобильные принципалы в connect-флоу не допускаются", async () => {
    // До сплита ключи отсекались невыдаваемым scope'ом write:omnichannel; после
    // carve-out'а пути requireAuth вообще не проверяет scope, поэтому гейт здесь.
    deps.getSession.mockResolvedValue(null)
    const route = withSocialConnectAuth("write", ok)
    expect((await route(req(), auth("admin") as never)).status).toBe(401)
  })

  it("подключение аккаунта остаётся admin-only, чтение провайдеров — по scope social", async () => {
    // Старт OAuth = интеграционная настройка (минтит токены провайдера, подписывает
    // вебхуки), поэтому держим прежнюю границу: роуты сидели на scope `settings`,
    // а он `[]` у manager/sales/support. Чтение списка провайдеров идёт внутри
    // рабочего пространства мониторинга, поэтому гейтится `social`.
    const start = withSocialConnectAuth("write", ok)
    const list = withSocialConnectAuth("read", ok)
    for (const role of ["manager", "sales", "support"]) {
      deps.getSession.mockResolvedValue(auth(role))
      expect((await start(req(), auth(role) as never)).status, `start:${role}`).toBe(403)
    }
    deps.getSession.mockResolvedValue(auth("manager"))
    expect((await list(req(), auth("manager") as never)).status).toBe(200)
    deps.getSession.mockResolvedValue(auth("support"))
    expect((await list(req(), auth("support") as never)).status).toBe(403)
  })

  it("пропускает тенанта с ЛЮБЫМ из двух модулей", async () => {
    const route = withSocialConnectAuth("write", ok)
    grant("omnichannel")
    expect((await route(req(), auth("admin") as never)).status).toBe(200)
    grant("social")
    expect((await route(req(), auth("admin") as never)).status).toBe(200)
  })

  it("403 когда нет ни одного из двух модулей", async () => {
    grant()
    const route = withSocialConnectAuth("write", ok)
    expect((await route(req(), auth("admin") as never)).status).toBe(403)
  })

  it("суперадмин проходит без модулей — как в requireAuth (модульный гейт его не касается)", async () => {
    grant()
    deps.getSession.mockResolvedValue(auth("superadmin"))
    const route = withSocialConnectAuth("write", ok)
    expect((await route(req(), auth("superadmin") as never)).status).toBe(200)
    expect(deps.orgHasModule).not.toHaveBeenCalled()
  })
})
