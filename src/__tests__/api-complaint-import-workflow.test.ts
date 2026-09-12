import ExcelJS from "exceljs"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  contactFindFirst: vi.fn(),
  contactCreate: vi.fn(),
  ticketCreate: vi.fn(),
  metaCreate: vi.fn(),
  commentCreate: vi.fn(),
  resolveCategory: vi.fn(),
  lockSequence: vi.fn(),
  nextNumber: vi.fn(),
  milestones: vi.fn(),
  audit: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findFirst: mocks.contactFindFirst, create: mocks.contactCreate },
    $transaction: mocks.transaction,
  },
  logAudit: mocks.audit,
}))
vi.mock("@/lib/with-rls", () => ({ withRlsAuth: (_module: string, _action: string, handler: unknown) => handler }))
vi.mock("@/lib/ticketing/category-service", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/ticketing/category-service")>()
  return { ...original, resolveTicketCategoryForWrite: mocks.resolveCategory, getContactRequesterSnapshot: vi.fn(), buildTicketRequesterSnapshot: vi.fn(() => ({})) }
})
vi.mock("@/lib/ticket-number", () => ({ lockTicketNumberSequence: mocks.lockSequence, nextTicketNumber: mocks.nextNumber }))
vi.mock("@/lib/entitlement-process/ticket-milestones", () => ({ createTicketEntitlementMilestones: mocks.milestones }))

import { POST } from "@/app/api/v1/complaints/import-xlsx/route"

const tx = {
  ticket: { create: mocks.ticketCreate },
  complaintMeta: { create: mocks.metaCreate },
  ticketComment: { create: mocks.commentCreate },
}
const auth = { orgId: "org-1", userId: "user-1", role: "support" }

async function workbookFile() {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Complaints")
  sheet.addRow(["Content", "Customer"])
  sheet.addRow(["First complaint", "Customer One"])
  sheet.addRow(["Second complaint", "Customer Two"])
  const bytes = await workbook.xlsx.writeBuffer()
  return new File([bytes], "complaints.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
}

async function request(options?: { dryRun?: boolean; retryRows?: number[] }) {
  const form = new FormData()
  form.set("file", await workbookFile())
  if (options?.dryRun) form.set("dryRun", "true")
  if (options?.retryRows) form.set("retryRows", JSON.stringify(options.retryRows))
  return new NextRequest("http://localhost/api/v1/complaints/import-xlsx", { method: "POST", body: form })
}

describe("complaint import workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveCategory.mockResolvedValue({ categoryId: "category-1" })
    mocks.contactFindFirst.mockResolvedValue(null)
    mocks.contactCreate.mockResolvedValue({ id: "contact-1" })
    mocks.nextNumber.mockResolvedValue("TK-100")
    mocks.ticketCreate.mockResolvedValue({ id: "ticket-1", companyId: null, createdAt: new Date(), priority: "medium" })
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
  })

  it("returns detected column mapping and row preview without writing", async () => {
    const response = await POST(await request({ dryRun: true }), auth)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data).toMatchObject({ dryRun: true, totalParsed: 2 })
    expect(json.data.mapping).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "content", column: "Content" }),
      expect.objectContaining({ field: "customerName", column: "Customer" }),
    ]))
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("retries only explicitly failed source rows", async () => {
    const response = await POST(await request({ retryRows: [3] }), auth)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data).toMatchObject({ imported: 1, totalParsed: 1, sourceTotal: 2, retriedRows: [3] })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.ticketCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ description: "Second complaint" }),
    }))
  })

  it("rejects unsupported files before parsing or database work", async () => {
    const form = new FormData()
    form.set("file", new File(["hello"], "complaints.csv", { type: "text/csv" }))
    const response = await POST(new NextRequest("http://localhost/api/v1/complaints/import-xlsx", { method: "POST", body: form }), auth)

    expect(response.status).toBe(400)
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
