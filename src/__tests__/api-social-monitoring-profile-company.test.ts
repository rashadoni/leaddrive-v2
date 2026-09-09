import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler<C = unknown> = (req: NextRequest, auth: AuthContext, ctx: C) => Promise<Response>

const mocks = vi.hoisted(() => ({
  findSubject: vi.fn(),
  findCompany: vi.fn(),
  updateSubjects: vi.fn(),
  logAudit: vi.fn(),
  fenceBlocked: false,
  registrations: [] as Array<{ module: string | undefined; action: string | undefined }>,
}))

vi.mock("@/lib/social/with-monitoring-mutation-fence", () => ({
  withSocialMonitoringMutationFence: (module: string | undefined, action: string | undefined, handler: RouteHandler) => {
    mocks.registrations.push({ module, action })
    return (req: NextRequest, ctx?: unknown) => {
      if (mocks.fenceBlocked) {
        return NextResponse.json(
          { error: "Social Monitoring is paused for a clean-slate reset", code: "social_monitoring_collection_blocked" },
          { status: 409 },
        )
      }
      return handler(req, { orgId: "org-1", userId: "user-1", role: "admin" }, ctx)
    }
  },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    monitoringSubject: { findFirst: mocks.findSubject, updateMany: mocks.updateSubjects },
    company: { findFirst: mocks.findCompany },
  },
  logAudit: mocks.logAudit,
}))

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { PUT } from "@/app/api/v1/social/monitoring-profiles/[id]/company/route"

function request(body?: unknown) {
  return new NextRequest("http://localhost/api/v1/social/monitoring-profiles/subject-1/company", {
    method: "PUT",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })
}

function params(id = "subject-1") {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fenceBlocked = false
  mocks.findSubject.mockResolvedValue({ id: "subject-1", name: "Bravo", companyId: null, company: null })
  mocks.findCompany.mockResolvedValue({ id: "company-1", name: "Bravo Supermarket MMC" })
  mocks.updateSubjects.mockResolvedValue({ count: 1 })
})

describe("PUT /api/v1/social/monitoring-profiles/[id]/company", () => {
  it("привязывает объект мониторинга к компании CRM", async () => {
    const response = await PUT(request({ companyId: "company-1" }), params())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data).toEqual({ id: "subject-1", company: { id: "company-1", name: "Bravo Supermarket MMC" } })
    expect(mocks.updateSubjects).toHaveBeenCalledWith({
      where: { organizationId: "org-1", id: "subject-1" },
      data: { companyId: "company-1" },
    })
    expect(mocks.logAudit).toHaveBeenCalledTimes(1)
  })

  it("снимает привязку по явному null", async () => {
    mocks.findSubject.mockResolvedValue({
      id: "subject-1",
      name: "Bravo",
      companyId: "company-1",
      company: { id: "company-1", name: "Bravo Supermarket MMC" },
    })

    const response = await PUT(request({ companyId: null }), params())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.data.company).toBeNull()
    expect(mocks.findCompany).not.toHaveBeenCalled()
    expect(mocks.updateSubjects).toHaveBeenCalledWith({
      where: { organizationId: "org-1", id: "subject-1" },
      data: { companyId: null },
    })
  })

  // Повторный клик по кнопке не должен плодить записи в журнале.
  it("идемпотентен: та же компания не пишет второй аудит и не трогает базу", async () => {
    mocks.findSubject.mockResolvedValue({
      id: "subject-1",
      name: "Bravo",
      companyId: "company-1",
      company: { id: "company-1", name: "Bravo Supermarket MMC" },
    })

    const response = await PUT(request({ companyId: "company-1" }), params())

    expect(response.status).toBe(200)
    expect(mocks.updateSubjects).not.toHaveBeenCalled()
    expect(mocks.logAudit).not.toHaveBeenCalled()
  })

  // Внешний ключ в Postgres проверяется в обход row security, поэтому
  // принадлежность компании тенанту обязана проверяться в коде.
  it("не привязывает компанию чужого тенанта", async () => {
    mocks.findCompany.mockResolvedValue(null)

    const response = await PUT(request({ companyId: "foreign-company" }), params())
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toBe("company_not_found")
    expect(mocks.updateSubjects).not.toHaveBeenCalled()
    expect(mocks.findCompany).toHaveBeenCalledWith({
      where: { organizationId: "org-1", id: "foreign-company" },
      select: { id: true, name: true },
    })
  })

  // Молча переписать связь нельзя: у карточки прежнего клиента блок
  // мониторинга просто опустеет, и никто не узнает, что объект увели.
  it("не перевешивает объект другого клиента без явного подтверждения", async () => {
    mocks.findSubject.mockResolvedValue({
      id: "subject-1",
      name: "Bravo",
      companyId: "company-A",
      company: { id: "company-A", name: "Первый клиент" },
    })

    const response = await PUT(request({ companyId: "company-B" }), params())
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.error).toBe("already_linked_to_other_company")
    expect(payload.data.company).toEqual({ id: "company-A", name: "Первый клиент" })
    expect(mocks.updateSubjects).not.toHaveBeenCalled()
  })

  it("передаёт объект по явному reassign и сохраняет прежнюю связь в аудите", async () => {
    mocks.findSubject.mockResolvedValue({
      id: "subject-1",
      name: "Bravo",
      companyId: "company-A",
      company: { id: "company-A", name: "Первый клиент" },
    })
    mocks.findCompany.mockResolvedValue({ id: "company-B", name: "Второй клиент" })

    const response = await PUT(request({ companyId: "company-B", reassign: true }), params())

    expect(response.status).toBe(200)
    expect(mocks.updateSubjects).toHaveBeenCalledWith({
      where: { organizationId: "org-1", id: "subject-1" },
      data: { companyId: "company-B" },
    })
    expect(mocks.logAudit).toHaveBeenCalledWith(
      "org-1", "update", "monitoring_profile", "subject-1",
      "company:company-B (was company-A)",
    )
  })

  // Архив — обратимое состояние оператора, а не удаление: привязать можно.
  it("разрешает привязку архивного объекта, но не удалённого", async () => {
    mocks.findSubject.mockResolvedValue({ id: "subject-1", name: "Bravo", companyId: null, company: null })

    const allowed = await PUT(request({ companyId: "company-1" }), params())
    expect(allowed.status).toBe(200)
    expect(mocks.findSubject).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { not: "deleted" } }),
    }))
  })

  it("404 на несуществующий или удалённый объект мониторинга", async () => {
    mocks.findSubject.mockResolvedValue(null)

    const response = await PUT(request({ companyId: "company-1" }), params("missing"))
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.error).toBe("monitoring_not_found")
    expect(mocks.findSubject).toHaveBeenCalledWith({
      where: { organizationId: "org-1", id: "missing", status: { not: "deleted" } },
      select: {
        id: true,
        name: true,
        companyId: true,
        company: { select: { id: true, name: true } },
      },
    })
  })

  it.each([
    [{}],
    [{ companyId: "" }],
    [{ companyId: 42 }],
    [{ companyId: "company-1", extra: true }],
  ])("отклоняет некорректное тело %j до обращения к базе", async (body) => {
    const response = await PUT(request(body), params())

    expect(response.status).toBe(400)
    expect(mocks.findSubject).not.toHaveBeenCalled()
  })

  it("не выполняется, пока сбор тенанта остановлен", async () => {
    mocks.fenceBlocked = true

    const response = await PUT(request({ companyId: "company-1" }), params())

    expect(response.status).toBe(409)
    expect(mocks.findSubject).not.toHaveBeenCalled()
  })

  it("зарегистрирован на право записи соцмониторинга", () => {
    expect(mocks.registrations).toContainEqual({ module: "social", action: "write" })
  })
})

// Ссылка из карточки компании обязана вести на существующие параметры:
// невалидный view молча откатился бы к списку, а выдуманный параметр имени
// не сделал бы ничего — кнопка «взять на мониторинг» обещала бы предзаполнение,
// которого нет.
describe("ссылки из карточки компании в соцмониторинг", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

  it("ведут на существующий view и на реально читаемый параметр имени", () => {
    const card = read("src/components/social/company-monitoring-link.tsx")
    const list = read("src/components/social/monitoring-profile-list.tsx")
    const page = read("src/app/(dashboard)/social-monitoring/page.tsx")

    expect(card).toContain("view=monitors&newMonitoringName=")
    expect(card).not.toContain("view=monitorings")
    // "monitors" входит в белый список значений view на странице.
    expect(page).toContain('"monitors", "mentions", "replies"')
    // Параметр реально читается и открывает мастер с подставленным именем.
    expect(list).toContain('new URLSearchParams(window.location.search).get("newMonitoringName")')
    expect(list).toContain("initialName={prefilledName ?? undefined}")
  })

  it("открывают карточку клиента полным набором параметров маршрута", () => {
    const card = read("src/components/social/company-monitoring-link.tsx")
    // parseMonitoringWorkspaceRoute требует monitoringId; без subjectName имя
    // подставилось бы идентификатором.
    expect(card).toContain("monitoringId=")
    expect(card).toContain("subjectId=")
    expect(card).toContain("subjectName=")
  })
})
