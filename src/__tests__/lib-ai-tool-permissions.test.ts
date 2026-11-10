/**
 * Права на действия ИИ — одно правило в ядре (src/lib/ai/tool-permissions.ts).
 *
 * До 2026-11-10 `executeTool` не спрашивал роль: сотрудник поддержки или
 * наблюдатель просил Da Vinci перевести сделку — и она переводилась. Здесь
 * проверяется поведение: роль без права получает отказ, и в базу не пишется
 * ничего — ни сама запись, ни карточка одобрения.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    deal: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({ id: "d-new", name: "Acme" }),
    },
    contact: { findFirst: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    activity: { create: vi.fn().mockResolvedValue({ id: "a1" }) },
    task: { create: vi.fn().mockResolvedValue({ id: "t1", title: "x" }) },
    pipeline: { findFirst: vi.fn().mockResolvedValue(null) },
    pipelineStage: { findFirst: vi.fn().mockResolvedValue(null) },
    aiPendingAction: { create: vi.fn().mockResolvedValue({ id: "pa1" }) },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }))

vi.mock("@/lib/revenue-intelligence/transition-recorder", () => ({
  recordStageTransition: vi.fn().mockResolvedValue("t-1"),
}))

vi.mock("@/lib/ticket-factory", () => ({
  createTicketWithAssignment: vi.fn().mockResolvedValue({ id: "tk1", ticketNumber: "TK-1" }),
}))

import { executeTool } from "@/lib/ai/tool-executor"
import { TOOL_META } from "@/lib/ai/tools"
import {
  AI_WRITE_TOOL_RULES,
  aiWriteToolOffered,
  aiWriteToolPermission,
} from "@/lib/ai/tool-permissions"
import { ALL_ROLES, checkPermission } from "@/lib/permissions"
import { prisma, logAudit } from "@/lib/prisma"
import { createTicketWithAssignment } from "@/lib/ticket-factory"

const deal = {
  id: "d1",
  organizationId: "org-1",
  stage: "LEAD",
  valueAmount: 1000,
  currency: "AZN",
  pipelineId: "p1",
  stageChangedAt: new Date("2026-01-01"),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.deal.findFirst).mockResolvedValue({ ...deal } as any)
  vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "c1", organizationId: "org-1" } as any)
})

describe("каждое пишущее действие ИИ имеет правило прав", () => {
  it("в TOOL_META нет пишущего действия без правила", () => {
    const writeTools = Object.entries(TOOL_META)
      .filter(([, meta]) => meta.category !== "read")
      .map(([name]) => name)
    expect(writeTools.length).toBeGreaterThan(0)
    expect(writeTools.filter((name) => !AI_WRITE_TOOL_RULES[name])).toEqual([])
  })

  it("действие без правила — отказ, а не «разрешено»", () => {
    expect(aiWriteToolPermission("admin", "drop_everything", {})).toEqual({ allowed: false, missing: "no_rule" })
  })

  it("без роли — отказ даже админскому действию", () => {
    expect(aiWriteToolPermission(undefined, "add_note", { entityType: "deal" }).allowed).toBe(false)
  })
})

describe("executeTool: роль решает, а не модель", () => {
  it("сотрудник поддержки (ticketing) не переводит сделку — сделка не тронута", async () => {
    expect(checkPermission("ticketing", "deals", "write")).toBe(false)
    const res = await executeTool("update_deal_stage", { dealId: "d1", stage: "WON" }, "org-1", "u-1", false, "ticketing")
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not allowed/i)
    expect(prisma.deal.update).not.toHaveBeenCalled()
    expect(logAudit).toHaveBeenCalledWith("org-1", "ai_action_denied", "update_deal_stage", "", expect.any(String), expect.anything())
  })

  it("наблюдатель не получает даже карточку одобрения письма", async () => {
    const res = await executeTool("send_email", { to: "client@example.com", subject: "s", body: "b" }, "org-1", "u-1", false, "viewer")
    expect(res.success).toBe(false)
    expect(res.requiresApproval).toBeUndefined()
    expect(prisma.aiPendingAction.create).not.toHaveBeenCalled()
  })

  it("наблюдатель не правит контакт и с пропуском одобрения", async () => {
    const res = await executeTool("update_contact", { contactId: "c1", fields: { phone: "1" } }, "org-1", "u-1", true, "viewer")
    expect(res.success).toBe(false)
    expect(prisma.contact.update).not.toHaveBeenCalled()
  })

  it("вызов без роли ничего не пишет", async () => {
    const res = await executeTool("create_task", { title: "x" }, "org-1", "u-1", true)
    expect(res.success).toBe(false)
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it("заметка в сделку от роли без права на сделки — отказ; в контакт — можно", async () => {
    const denied = await executeTool("add_note", { entityType: "deal", entityId: "d1", content: "x" }, "org-1", "u-1", false, "ticketing")
    expect(denied.success).toBe(false)
    expect(prisma.activity.create).not.toHaveBeenCalled()

    const allowed = await executeTool("add_note", { entityType: "contact", entityId: "c1", content: "x" }, "org-1", "u-1", false, "ticketing")
    expect(allowed.success).toBe(true)
    expect(prisma.activity.create).toHaveBeenCalledTimes(1)
  })

  it("заметка без известной карточки — отказ", async () => {
    const res = await executeTool("add_note", { entityType: "invoice", entityId: "i1", content: "x" }, "org-1", "u-1", false, "admin")
    expect(res.success).toBe(false)
    expect(prisma.activity.create).not.toHaveBeenCalled()
  })

  it("продажник переводит сделку, как на экране", async () => {
    expect(checkPermission("sales", "deals", "write")).toBe(true)
    const res = await executeTool("update_deal_stage", { dealId: "d1", stage: "QUALIFIED" }, "org-1", "u-1", false, "sales")
    expect(res.success).toBe(true)
    expect(prisma.deal.update).toHaveBeenCalledTimes(1)
  })

  it("тикет создаёт только роль с правом на тикеты", async () => {
    const denied = await executeTool("create_ticket", { subject: "x" }, "org-1", "u-1", false, "viewer")
    expect(denied.success).toBe(false)
    const allowed = await executeTool("create_ticket", { subject: "x" }, "org-1", "u-1", false, "ticketing")
    expect(allowed.success).toBe(true)
    expect(createTicketWithAssignment).toHaveBeenCalledTimes(1)
  })
})

describe("модели не предлагается то, что роли закрыто", () => {
  it("для каждой роли предложенное действие совпадает с правом экрана", () => {
    for (const role of ALL_ROLES) {
      expect(aiWriteToolOffered(role, "update_deal_stage")).toBe(checkPermission(role, "deals", "write"))
      expect(aiWriteToolOffered(role, "create_ticket")).toBe(checkPermission(role, "tickets", "write"))
      expect(aiWriteToolOffered(role, "update_contact")).toBe(checkPermission(role, "contacts", "write"))
    }
    expect(aiWriteToolOffered("viewer", "send_email")).toBe(false)
    expect(aiWriteToolOffered("viewer", "add_note")).toBe(false)
    expect(aiWriteToolOffered(undefined, "add_note")).toBe(false)
  })
})
