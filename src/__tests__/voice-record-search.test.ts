import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  contactFindMany: vi.fn(),
  leadFindMany: vi.fn(),
  divisionFindMany: vi.fn(),
  productFindMany: vi.fn(),
  quoteFindMany: vi.fn(),
  campaignFindMany: vi.fn(),
  ticketFindMany: vi.fn(),
  contractFindMany: vi.fn(),
  eventFindMany: vi.fn(),
  taskFindMany: vi.fn(),
  getAccessibleDivisionIds: vi.fn(),
  buildTaskListWhere: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: { findMany: mocks.contactFindMany },
    lead: { findMany: mocks.leadFindMany },
    division: { findMany: mocks.divisionFindMany },
    product: { findMany: mocks.productFindMany },
    quote: { findMany: mocks.quoteFindMany },
    campaign: { findMany: mocks.campaignFindMany },
    ticket: { findMany: mocks.ticketFindMany },
    contract: { findMany: mocks.contractFindMany },
    event: { findMany: mocks.eventFindMany },
    task: { findMany: mocks.taskFindMany },
  },
}))

vi.mock("@/lib/tasks/board-access", () => ({
  getAccessibleDivisionIds: mocks.getAccessibleDivisionIds,
}))

vi.mock("@/lib/tasks/list-query", () => ({
  buildTaskListWhere: mocks.buildTaskListWhere,
}))

import { findVoiceRecords } from "@/lib/ai/voice/summaries"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("voice record search for every openable record family", () => {
  it("uses the current Contact.fullName and Lead.contactName schema fields", async () => {
    mocks.contactFindMany.mockResolvedValue([
      { id: "contact-1", fullName: "Aysel Məmmədova", position: "CFO" },
    ])
    mocks.leadFindMany.mockResolvedValue([
      { id: "lead-1", contactName: "Nigar Əliyeva", companyName: "Caspian", status: "new" },
    ])

    const contact = await findVoiceRecords("org-1", "contact", "Aysel", {
      userId: "manager-1",
      role: "manager",
    })
    const lead = await findVoiceRecords("org-1", "lead", "Nigar", {
      userId: "manager-1",
      role: "manager",
    })

    expect(mocks.contactFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        fullName: { contains: "Aysel", mode: "insensitive" },
        organizationId: "org-1",
      },
      select: { id: true, fullName: true, position: true },
    }))
    expect(mocks.leadFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { contactName: { contains: "Nigar", mode: "insensitive" } },
          { companyName: { contains: "Nigar", mode: "insensitive" } },
        ],
        organizationId: "org-1",
      },
      select: { id: true, contactName: true, companyName: true, status: true },
    }))
    expect(contact.matches[0]).toEqual({ id: "contact-1", name: "Aysel Məmmədova", hint: "CFO" })
    expect(lead.matches[0]).toEqual({ id: "lead-1", name: "Nigar Əliyeva", hint: "Caspian, new" })
  })

  it("limits board lookup to the canonical per-user board scope", async () => {
    mocks.getAccessibleDivisionIds.mockResolvedValue(["visible-board"])
    mocks.divisionFindMany.mockResolvedValue([
      { id: "visible-board", name: "Retail Ops", key: "RTL", isDepartment: false },
    ])

    const result = await findVoiceRecords("org-1", "board", "retail", {
      userId: "sales-1",
      role: "sales",
    })

    expect(mocks.getAccessibleDivisionIds).toHaveBeenCalledWith(
      expect.any(Object),
      "org-1",
      "sales-1",
      "sales",
    )
    expect(mocks.divisionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        isActive: true,
        id: { in: ["visible-board"] },
      }),
      take: 7,
    }))
    expect(result.matches).toEqual([
      { id: "visible-board", name: "Retail Ops", hint: "RTL, board" },
    ])
  })

  it("searches products by name or SKU and never drops tenant scope", async () => {
    mocks.productFindMany.mockResolvedValue([
      { id: "product-1", name: "Support Plus", sku: "SUP-1", category: "service", price: 99.4, currency: "AZN" },
    ])

    const result = await findVoiceRecords("org-1", "product", "SUP", {
      userId: "manager-1",
      role: "manager",
    })

    expect(mocks.productFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { name: { contains: "SUP", mode: "insensitive" } },
          { sku: { contains: "SUP", mode: "insensitive" } },
        ],
        organizationId: "org-1",
      },
      take: 7,
    }))
    expect(result.matches[0]).toEqual({
      id: "product-1",
      name: "Support Plus",
      hint: "SUP-1, service, 99 AZN",
    })
  })

  it("returns quote candidates without capability or rejection fields", async () => {
    mocks.quoteFindMany.mockResolvedValue([
      { id: "quote-1", quoteNumber: "Q-42", version: 2, status: "sent", totalAmount: 1250, currency: "AZN" },
    ])

    const result = await findVoiceRecords("org-1", "quote", "Q-42", {
      userId: "manager-1",
      role: "manager",
    })

    expect(mocks.quoteFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        quoteNumber: { contains: "Q-42", mode: "insensitive" },
        organizationId: "org-1",
      },
      select: {
        id: true,
        quoteNumber: true,
        version: true,
        status: true,
        totalAmount: true,
        currency: true,
      },
    }))
    expect(result.matches[0]).toEqual({ id: "quote-1", name: "Q-42 v2", hint: "sent, 1250 AZN" })
  })

  it("finds tickets and contracts by their visible record numbers or titles", async () => {
    mocks.ticketFindMany.mockResolvedValue([
      { id: "ticket-1", ticketNumber: "TKT-104", subject: "Delivery delay", status: "open", priority: "high" },
    ])
    mocks.contractFindMany.mockResolvedValue([
      { id: "contract-1", contractNumber: "CONTRACT-42", title: "Annual support", status: "active" },
    ])

    const ticket = await findVoiceRecords("org-1", "ticket", "TKT-104", {
      userId: "manager-1",
      role: "manager",
    })
    const contract = await findVoiceRecords("org-1", "contract", "CONTRACT-42", {
      userId: "manager-1",
      role: "manager",
    })

    expect(mocks.ticketFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { ticketNumber: { contains: "TKT-104", mode: "insensitive" } },
          { subject: { contains: "TKT-104", mode: "insensitive" } },
        ],
        organizationId: "org-1",
      },
    }))
    expect(mocks.contractFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { contractNumber: { contains: "CONTRACT-42", mode: "insensitive" } },
          { title: { contains: "CONTRACT-42", mode: "insensitive" } },
        ],
        organizationId: "org-1",
      },
    }))
    expect(ticket.matches[0]).toEqual({
      id: "ticket-1",
      name: "TKT-104: Delivery delay",
      hint: "open, high",
    })
    expect(contract.matches[0]).toEqual({
      id: "contract-1",
      name: "CONTRACT-42: Annual support",
      hint: "active",
    })
  })

  it("searches campaign and event names with bounded, tenant-scoped reads", async () => {
    mocks.campaignFindMany.mockResolvedValue([
      { id: "campaign-1", name: "Autumn launch", type: "email", status: "draft" },
    ])
    mocks.eventFindMany.mockResolvedValue([
      { id: "event-1", name: "Autumn summit", status: "planned", startDate: new Date("2026-10-02T09:00:00Z") },
    ])

    const campaign = await findVoiceRecords("org-1", "campaign", "autumn", {
      userId: "manager-1",
      role: "manager",
    })
    const event = await findVoiceRecords("org-1", "event", "autumn", {
      userId: "manager-1",
      role: "manager",
    })

    expect(mocks.campaignFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        name: { contains: "autumn", mode: "insensitive" },
        organizationId: "org-1",
      },
      take: 7,
    }))
    expect(mocks.eventFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        name: { contains: "autumn", mode: "insensitive" },
        organizationId: "org-1",
      },
      take: 7,
    }))
    expect(campaign.matches[0]?.hint).toBe("email, draft")
    expect(event.matches[0]?.hint).toBe("planned, 2026-10-02")
  })

  it("finds complaints through Ticket.complaintMeta, not a nonexistent model", async () => {
    mocks.ticketFindMany.mockResolvedValue([
      {
        id: "ticket-1",
        subject: "Late delivery",
        status: "new",
        priority: "high",
        complaintMeta: { riskLevel: "medium" },
      },
    ])

    const result = await findVoiceRecords("org-1", "complaint", "delivery", {
      userId: "manager-1",
      role: "manager",
    })

    expect(mocks.ticketFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        complaintMeta: { isNot: null },
        subject: { contains: "delivery", mode: "insensitive" },
        organizationId: "org-1",
      },
      take: 7,
    }))
    expect(result.matches[0]).toEqual({
      id: "ticket-1",
      name: "Late delivery",
      hint: "new, high, medium",
    })
  })

  it("reuses the task list visibility builder for lower-scope users", async () => {
    const restrictedWhere = {
      organizationId: "org-1",
      deletedAt: null,
      AND: [{ OR: [{ assignedTo: "sales-1" }] }],
    }
    mocks.buildTaskListWhere.mockResolvedValue({ where: restrictedWhere, blocked: false })
    mocks.taskFindMany.mockResolvedValue([
      { id: "task-1", title: "Call supplier", taskKey: "OPS-7", status: "todo", priority: "high" },
    ])

    const result = await findVoiceRecords("org-1", "task", "supplier", {
      userId: "sales-1",
      role: "sales",
    })

    expect(mocks.buildTaskListWhere).toHaveBeenCalledWith(
      "org-1",
      "sales-1",
      "sales",
      expect.objectContaining({ search: "supplier" }),
    )
    expect(mocks.taskFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: restrictedWhere,
      take: 7,
    }))
    expect(result.matches[0]).toEqual({
      id: "task-1",
      name: "Call supplier",
      hint: "OPS-7, todo, high",
    })
  })
})
