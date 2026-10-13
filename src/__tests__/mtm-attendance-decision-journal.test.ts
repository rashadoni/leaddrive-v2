import { randomUUID } from "node:crypto"
import { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import ExcelJS from "exceljs"
import { createTranslator, type AbstractIntlMessages } from "next-intl"
import { attendancePdfText } from "./helpers/attendance-pdf"

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./mocks/mtm-prisma")).makeMtmPrismaMock() }))
vi.mock("@/lib/api-auth", () => ({ requireAuth: vi.fn(), getOrgId: vi.fn(), getSession: vi.fn().mockResolvedValue(null), isAuthError: (value: unknown) => value instanceof Response }))
vi.mock("@/lib/mtm/route-permissions", async original => ({ ...await original<typeof import("@/lib/mtm/route-permissions")>(), resolveMtmRouteActor: vi.fn() }))
vi.mock("@/lib/tenant-capability-access", async original => ({ ...await original<typeof import("@/lib/tenant-capability-access")>(), requireTenantCapabilityAccessResponse: vi.fn().mockResolvedValue(null) }))
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { requireTenantCapabilityAccessResponse } from "@/lib/tenant-capability-access"
import { GET, POST } from "@/app/api/v1/mtm/attendance/decisions/route"
import { AttendanceDecisionJournalQuerySchema, type AttendanceDecisionJournal } from "@/lib/mtm/attendance-decision-journal-contract"
import { readAttendanceDecisionJournal } from "@/lib/mtm/attendance-decision-journal-store"
import { buildAttendanceDecisionJournalTable } from "@/lib/mtm/attendance-decision-journal-table"
import { defaultAttendanceDayKinds } from "@/lib/mtm/attendance-day-kinds"
import { getRlsContext } from "@/lib/rls-context"
import en from "../../messages/en.json"
import ru from "../../messages/ru.json"
import az from "../../messages/az.json"
const org = "journal-fixture-org", query = { from: "2026-10-01", to: "2026-10-31", status: "ALL" as const }
const employee = "journal-employee", actor = { role: "ADMIN" as const, agentId: null, scopedAgentIds: null }
function row() { return { id: randomUUID(), organizationId: org, agentId: employee, status: "APPROVED", startDate: new Date("2026-09-29"), endDate: new Date("2026-10-02"),
  submittedAt: new Date("2026-09-01T08:00:00Z"), decidedAt: new Date("2026-09-02T08:00:00Z"), decidedByUserId: "reviewer", cancelledAt: null as Date | null,
  attendanceDetails: { version: 1, kind: "ANNUAL_LEAVE", unit: "DAYS", startTime: null, endTime: null, timezone: "Asia/Baku", attachmentIds: [randomUUID()], submissionHash: "a".repeat(64),
    dayKind: defaultAttendanceDayKinds(() => ({ az: "Demo məzuniyyət", ru: "Демонстрационный отпуск", en: "Demo leave" })).find(kind => kind.key === "ANNUAL_LEAVE")! },
  // Deliberately present in the fake storage to exercise the output allowlist.
  reason: "PRIVATE_MEDICAL_REASON", decisionNote: "PRIVATE_DECISION_NOTE", agent: { name: "=Fictional employee", team: { name: "Fictional team" } } } }
let rows: ReturnType<typeof row>[], audits: Array<{ entityId: string; actorUserId: string | null; createdAt: Date }>
const read = () => GET(new NextRequest(`http://localhost/api/v1/mtm/attendance/decisions?${new URLSearchParams(query)}`))
const exportRequest = (body: unknown) => POST(new NextRequest("http://localhost/api/v1/mtm/attendance/decisions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
beforeEach(() => {
  vi.resetAllMocks(); rows = [row()]; audits = []
  vi.mocked(requireAuth).mockResolvedValue({ orgId: org, userId: "reader", role: "admin", email: "fixture@example.invalid", name: "Reader", principalType: "session" } as never)
  vi.mocked(requireTenantCapabilityAccessResponse).mockResolvedValue(null)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue(actor)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: true }, { key: "timezone", value: "Asia/Baku" }] as never)
  vi.mocked(prisma.$queryRaw).mockResolvedValue([])
  vi.mocked(prisma.$transaction).mockImplementation((async (callback: (tx: typeof prisma) => unknown) => callback(prisma)) as never)
  vi.mocked(prisma.mtmHrmRequest.findMany).mockImplementation((async () => rows) as never)
  vi.mocked(prisma.mtmAuditLog.findMany).mockImplementation((async () => audits) as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "reviewer", name: "Original reviewer" }, { id: "canceller", name: "Cancellation reviewer" }] as never)
})
describe("safe attendance request/decision journal and actual files", () => {
  it("uses tenant RLS, requested-date overlap and a strict private-field allowlist", async () => {
    vi.mocked(prisma.mtmHrmRequest.findMany).mockImplementation((async () => { expect(getRlsContext()).toMatchObject({ orgId: org }); return rows }) as never)
    const response = await read(); expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data.items[0]).toMatchObject({ employeeName: "=Fictional employee", source: "EMPLOYEE", submittedByName: "=Fictional employee", decision: { byName: "Original reviewer" }, cancellation: null })
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|attachmentIds|submissionHash|storageKey|reason|decisionNote/)
    expect(prisma.mtmHrmRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: org,
      startDate: { lte: new Date("2026-10-31") }, endDate: { gte: new Date("2026-10-01") } }) }))
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
  it("defaults an empty initial query to the organization's current civil month", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-31T21:00:00Z"))
    try {
      const response = await GET(new NextRequest("http://localhost/api/v1/mtm/attendance/decisions"))
      expect(await response.json()).toMatchObject({ data: { snapshot: { query: { from: "2026-11-01", to: "2026-11-30", status: "ALL" } } } })
    } finally { vi.useRealTimers() }
  })
  it("supports the current explicit read-only HR grant without granting write or document access", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: org, userId: "reader", role: "viewer", email: "fixture@example.invalid", name: "Reader", principalType: "session" } as never)
    vi.mocked(resolveMtmRouteActor).mockResolvedValue(null)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ role: "viewer", hiddenModules: [], mtmAttendanceAll: true }] as never)
    const response = await read(); expect(response.status).toBe(200)
    vi.mocked(prisma.$queryRaw).mockResolvedValue([{ role: "viewer", hiddenModules: [], mtmAttendanceAll: false }] as never)
    expect((await read()).status).toBe(403)
  })
  it("keeps managers scoped and refuses an unproven organization-wide manager actor", async () => {
    await readAttendanceDecisionJournal({ organizationId: org, actor: { role: "MANAGER", agentId: "manager", scopedAgentIds: [employee] }, query })
    expect(prisma.mtmHrmRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ agentId: { in: [employee] } }) }))
    await expect(readAttendanceDecisionJournal({ organizationId: org, actor: { role: "MANAGER", agentId: "manager", scopedAgentIds: null }, query })).rejects.toMatchObject({ status: 403 })
  })
  it("retains HR submission and original approval separately from a later cancellation", async () => {
    const hr = row(); hr.attendanceDetails.kind = "HR_RECORD"; hr.attendanceDetails.attachmentIds = []
    Object.assign(hr.attendanceDetails, { recording: { userId: "reviewer", operationId: randomUUID() } })
    hr.status = "CANCELLED"; hr.cancelledAt = new Date("2026-10-13T10:00:00Z"); rows = [hr]
    audits = [{ entityId: hr.id, actorUserId: "canceller", createdAt: hr.cancelledAt }]
    const response = await read(); expect(response.status).toBe(200)
    expect((await response.json()).data.items[0]).toMatchObject({ source: "HR", submittedByName: "Original reviewer", decision: { byName: "Original reviewer" }, cancellation: { byName: "Cancellation reviewer", at: hr.cancelledAt.toISOString() } })
    expect(prisma.mtmAuditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { entityId: true, actorUserId: true, createdAt: true } }))
  })
  it("attributes withdrawal of a pending request to the employee without inventing a manager decision", async () => {
    rows[0].status = "CANCELLED"; rows[0].decidedAt = null as never; rows[0].decidedByUserId = null as never; rows[0].cancelledAt = new Date("2026-10-13T10:00:00Z")
    expect((await (await read()).json()).data.items[0]).toMatchObject({ decision: null, cancellation: { byName: "=Fictional employee" } })
  })
  it("refuses an approved cancellation without its history, and never silently truncates the file", async () => {
    rows[0].status = "CANCELLED"; rows[0].cancelledAt = new Date("2026-10-13T10:00:00Z")
    expect((await read()).status).toBe(409)
    rows = Array.from({ length: 10_001 }, () => row())
    expect((await read()).status).toBe(422)
  })
  it.each(["az", "ru", "en"] as const)("exports the exact safe screen cells with Unicode in %s", async locale => {
    const response = await read(), journal: AttendanceDecisionJournal = (await response.json()).data
    const messages: AbstractIntlMessages = ({ az, ru, en })[locale]
    const table = buildAttendanceDecisionJournalTable(journal, locale, createTranslator({ locale, messages, namespace: "mtmAttendance" }))
    const xlsx = await exportRequest({ snapshot: journal.snapshot, format: "xlsx", locale }); expect(xlsx.status).toBe(200)
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as never)
    expect(book.worksheets[0].getRow(2).values).toEqual([undefined, ...table.rows[0].cells.map(cell => typeof cell === "string" && cell.startsWith("=") ? `'${cell}` : cell)])
    const pdf = await exportRequest({ snapshot: journal.snapshot, format: "pdf", locale }); expect(pdf.status).toBe(200)
    const text = attendancePdfText(Buffer.from(await pdf.arrayBuffer())).replace(/\s+/g, " ")
    expect(text).toContain("Fictional employee"); expect(text).toContain("Original reviewer")
    expect(text).toContain(rows[0].attendanceDetails.dayKind.names[locale])
    expect(text + JSON.stringify(book.worksheets.map(sheet => sheet.getSheetValues()))).not.toMatch(/PRIVATE_|attachmentIds|submissionHash|storageKey/)
    expect(pdf.headers.get("content-type")).toBe("application/pdf")
  })
  it("rejects a changed snapshot and reapplies scope and feature access before exporting", async () => {
    const snapshot = (await (await read()).json()).data.snapshot
    rows[0].status = "REJECTED"
    expect((await exportRequest({ snapshot, format: "pdf", locale: "en" })).status).toBe(409)
    vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([{ key: "attendanceEnabled", value: false }] as never)
    expect((await exportRequest({ snapshot, format: "pdf", locale: "en" })).status).toBe(404)
    expect((await read()).status).toBe(404)
  })
  it.each([{ from: "2026-01-01", to: "2027-01-02" }, { from: "2026-02-30", to: "2026-03-01" }, { ...query, status: "BROKEN" }, { ...query, organizationId: "foreign" }])("rejects invalid filters: %j", invalid => {
    expect(AttendanceDecisionJournalQuerySchema.safeParse(invalid).success).toBe(false)
  })
})
