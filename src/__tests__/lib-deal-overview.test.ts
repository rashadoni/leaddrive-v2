/**
 * The part of the deal page that can be wrong (src/lib/deals/deal-overview.ts):
 * which invoice is a debt, which rule of the next stage is unmet, how long the
 * deal stood on a stage. The first case is the owner's own deal on production,
 * the one the page was redesigned on: a won deal with invoice INV-2026-00060
 * of 4,130 AZN, due 28 April 2026 and unpaid, with no owner and no contact.
 */
import { describe, expect, it } from "vitest"
import { dayMonth } from "@/components/deals/overview/deal-next-steps"
import {
  buildNextSteps, daysOverdue, daysUntil, nextStage, paymentSummary, splitStages, stageChanges,
  stageKind, stageSegments, unmetRules, type InvoiceLike, type StageRule,
} from "@/lib/deals/deal-overview"

const NOW = new Date(2026, 10, 21, 15, 0, 0)
const invoice = (over: Partial<InvoiceLike> = {}): InvoiceLike => ({
  id: "inv-60", invoiceNumber: "INV-2026-00060", status: "overdue", totalAmount: 4130, paidAmount: 0,
  balanceDue: 4130, currency: "AZN", dueDate: new Date(2026, 3, 28).toISOString(), ...over,
})
const STAGES = [
  { name: "LEAD" }, { name: "PROPOSAL" }, { name: "NEGOTIATION" },
  { name: "WON", isWon: true }, { name: "LOST", isLost: true },
]

describe("stages", () => {
  it("reads what a stage means from the pipeline's flags, whatever it is called", () => {
    expect(stageKind({ name: "Qazanıldı", isWon: true })).toBe("won")
    expect(stageKind({ name: "Отказ", isLost: true })).toBe("lost")
    expect(stageKind({ name: "PROPOSAL" })).toBe("open")
    // No pipeline loaded: the standard spelling is all there is to go by.
    expect(stageKind(null, "WON")).toBe("won")
    expect(stageKind(undefined, "LOST")).toBe("lost")
  })

  it("takes «lost» out of the track: it is an outcome, not the step after «won»", () => {
    const { track, lost } = splitStages(STAGES)
    expect(track.map((s) => s.name)).toEqual(["LEAD", "PROPOSAL", "NEGOTIATION", "WON"])
    expect(lost.map((s) => s.name)).toEqual(["LOST"])
  })

  it("names the next stage of an open deal only", () => {
    expect(nextStage(STAGES, "LEAD")?.name).toBe("PROPOSAL")
    expect(nextStage(STAGES, "NEGOTIATION")?.name).toBe("WON")
    expect(nextStage(STAGES, "WON")).toBeNull()
    expect(nextStage(STAGES, "LOST")).toBeNull()
    expect(nextStage(STAGES, "UNKNOWN")).toBeNull()
  })
})

describe("rules of a stage", () => {
  const rules: StageRule[] = [
    { fieldName: "contactId", ruleType: "required", errorMessage: "Нужен контакт" },
    { fieldName: "valueAmount", ruleType: "min_value", ruleValue: "1000", errorMessage: "Сумма от 1000" },
    { fieldName: "tasks", ruleType: "task_completed", errorMessage: "Закройте задачу" },
    { fieldName: "files", ruleType: "file_attached", errorMessage: "Приложите файл" },
  ]

  it("reads them as the server does", () => {
    const unmet = (deal: Record<string, unknown>, tasks: number) => unmetRules(deal, rules, tasks).map((r) => r.fieldName)
    expect(unmet({ contactId: null, valueAmount: 500 }, 0)).toEqual(["contactId", "valueAmount", "tasks"])
    expect(unmet({ contactId: "c1", valueAmount: 1000 }, 2)).toEqual([])
    // Zero is a value for «required»; a missing amount is not «below the minimum» — the server lets it through.
    expect(unmetRules({ probability: 0 }, [{ fieldName: "probability", ruleType: "required", errorMessage: "" }], 0)).toEqual([])
    expect(unmet({ contactId: "c1" }, 1)).toEqual([])
  })
})

describe("invoices", () => {
  it("counts whole days past the due date and none before it", () => {
    expect(daysOverdue(invoice(), NOW)).toBe(207)
    expect(daysOverdue(invoice({ dueDate: new Date(2026, 10, 21, 23, 59).toISOString() }), NOW)).toBe(0)
    expect(daysOverdue(invoice({ dueDate: new Date(2026, 10, 20, 23, 59).toISOString() }), NOW)).toBe(1)
    expect(daysOverdue(invoice({ balanceDue: 0, paidAmount: 4130 }), NOW)).toBe(0)
    expect(daysOverdue(invoice({ dueDate: null }), NOW)).toBe(0)
  })

  it("does not add up different currencies, and leaves out what is not billed", () => {
    const summary = paymentSummary([
      invoice(),
      invoice({ id: "usd", currency: "USD", totalAmount: 100, paidAmount: 40, balanceDue: 60, status: "partially_paid", dueDate: null }),
      invoice({ id: "draft", status: "draft", totalAmount: 999, balanceDue: 999 }),
      invoice({ id: "void", status: "cancelled", totalAmount: 999, balanceDue: 999 }),
    ], NOW)
    expect(summary.count).toBe(2)
    expect(summary.byCurrency).toEqual([
      { currency: "AZN", total: 4130, paid: 0, due: 4130 },
      { currency: "USD", total: 100, paid: 40, due: 60 },
    ])
    expect(summary.overdueCount).toBe(1)
  })
})

describe("what to do now", () => {
  const base = { nextStageRules: [] as StageRule[], completedTasks: 0, now: NOW }

  it("the owner's deal: an overdue debt first, then nobody answers for it, then nobody to talk to", () => {
    const result = buildNextSteps({ ...base, deal: { assignedTo: null, contactId: null }, kind: "won", invoices: [invoice()] })
    expect(result.steps.map((s) => [s.kind, s.done, s.urgent])).toEqual([
      ["pay", false, true], ["owner", false, false], ["contact", false, false],
    ])
    expect(result.steps[0]).toMatchObject({ overdueDays: 207, invoice: { invoiceNumber: "INV-2026-00060" } })
    expect([result.done, result.left]).toEqual([0, 3])
  })

  it("when the invoice is paid and both people are set, everything is done", () => {
    const paid = invoice({ status: "paid", paidAmount: 4130, balanceDue: 0 })
    const result = buildNextSteps({ ...base, deal: { assignedTo: "u1", contactId: "c1" }, kind: "won", invoices: [paid] })
    expect(result.steps.map((s) => s.kind)).toEqual(["paid", "owner", "contact"])
    expect([result.done, result.left]).toEqual([3, 0])
  })

  it("a deal with no invoice has no payment step at all", () => {
    const result = buildNextSteps({ ...base, deal: { assignedTo: "u1", contactId: null }, kind: "open", invoices: [invoice({ status: "draft" })] })
    expect(result.steps.map((s) => s.kind)).toEqual(["owner", "contact"])
  })

  it("an open deal also lists what the next stage asks for, without repeating the owner and the contact", () => {
    const rules: StageRule[] = [
      { fieldName: "contactId", ruleType: "required", errorMessage: "Нужен контакт" },
      { fieldName: "expectedClose", ruleType: "required", errorMessage: "Укажите дату закрытия" },
      { fieldName: "valueAmount", ruleType: "min_value", ruleValue: "1000", errorMessage: "Сумма от 1000" },
    ]
    const result = buildNextSteps({
      ...base, nextStageRules: rules, kind: "open", invoices: [],
      deal: { assignedTo: "u1", contactId: null, expectedClose: null, valueAmount: 3500 },
    })
    expect(result.steps.map((s) => [s.kind, s.done])).toEqual([["owner", true], ["contact", false], ["rule", false], ["rule", true]])
    expect(result.steps.filter((s) => s.kind === "rule").map((s) => s.kind === "rule" && s.rule.fieldName)).toEqual(["expectedClose", "valueAmount"])
    // A won deal moves nowhere: the same rules are not its steps.
    expect(buildNextSteps({ ...base, nextStageRules: rules, kind: "won", invoices: [], deal: {} }).steps.map((s) => s.kind)).toEqual(["owner", "contact"])
  })

  it("shows the three most overdue invoices and counts the rest", () => {
    const many = [10, 40, 0, 90, 5].map((days, i) => invoice({
      id: `i${i}`, status: "sent", dueDate: new Date(2026, 10, 21 - days).toISOString(),
    }))
    const result = buildNextSteps({ ...base, deal: { assignedTo: "u", contactId: "c" }, kind: "open", invoices: many })
    expect(result.steps.filter((s) => s.kind === "pay").map((s) => s.kind === "pay" && s.overdueDays)).toEqual([90, 40, 10])
    expect(result.morePayments).toBe(2)
  })

  it("a lost deal has nothing to do on it", () => {
    expect(buildNextSteps({ ...base, deal: {}, kind: "lost", invoices: [invoice()] })).toEqual({ steps: [], morePayments: 0, done: 0, left: 0 })
  })
})

describe("history of stages", () => {
  const created = new Date(2026, 2, 17, 10).toISOString()
  const at = (month: number, day: number) => new Date(2026, month, day, 12).toISOString()

  it("takes only real stage moves from the journal, oldest first", () => {
    const changes = stageChanges([
      { action: "update", oldValue: { stage: "PROPOSAL" }, newValue: { stage: "WON" }, createdAt: at(2, 29) },
      { action: "update", oldValue: { name: "a" }, newValue: { name: "b" }, createdAt: at(2, 18) },
      { action: "update", oldValue: { stage: "LEAD" }, newValue: { stage: "PROPOSAL" }, createdAt: at(2, 20) },
      { action: "update", oldValue: { stage: "WON" }, newValue: { stage: "WON" }, createdAt: at(3, 1) },
      { action: "update", newValue: { stage: "X" }, createdAt: "not a date" },
    ])
    expect(changes).toEqual([
      { at: at(2, 20), from: "LEAD", to: "PROPOSAL" },
      { at: at(2, 29), from: "PROPOSAL", to: "WON" },
    ])
  })

  it("lays the moves out as how long the deal stood on each stage", () => {
    const segments = stageSegments(created, "WON", [
      { at: at(2, 20), from: "LEAD", to: "PROPOSAL" },
      { at: at(2, 29), from: "PROPOSAL", to: "WON" },
    ], NOW)
    expect(segments.map((s) => [s.stage, s.days, s.to === null])).toEqual([["LEAD", 3, false], ["PROPOSAL", 9, false], ["WON", 237, true]])
  })

  it("with no recorded move says only what is known: the current stage since the deal was created", () => {
    expect(stageSegments(created, "WON", [], NOW)).toEqual([{ stage: "WON", from: created, to: null, days: 249 }])
  })

  it("does not name the first stage when the journal does not", () => {
    const segments = stageSegments(created, "WON", [{ at: at(2, 29), from: null, to: "WON" }], NOW)
    expect(segments[0]).toMatchObject({ stage: null, days: 12 })
  })
})

describe("planned", () => {
  it("says a day in words in all three languages — Chrome has no Azerbaijani month names of its own", () => {
    const day = new Date(2026, 10, 24, 9).toISOString()
    expect(dayMonth(day, "az", NOW)).toBe("24 noyabr")
    expect(dayMonth(day, "ru", NOW)).toBe("24 ноября")
    expect(dayMonth(day, "en", NOW)).toMatch(/24/)
    expect(dayMonth(new Date(2027, 0, 5, 9).toISOString(), "az", NOW)).toBe("5 yanvar 2027")
  })

  it("counts days by the calendar, not by 24 hours", () => {
    expect(daysUntil(new Date(2026, 10, 21, 0, 5).toISOString(), NOW)).toBe(0)
    expect(daysUntil(new Date(2026, 10, 22, 0, 5).toISOString(), NOW)).toBe(1)
    expect(daysUntil(new Date(2026, 10, 20, 23, 55).toISOString(), NOW)).toBe(-1)
    expect(daysUntil(new Date(2026, 10, 24, 9).toISOString(), NOW)).toBe(3)
  })
})
