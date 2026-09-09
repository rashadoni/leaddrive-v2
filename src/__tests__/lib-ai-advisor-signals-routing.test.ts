import { describe, expect, it } from "vitest"
import { filterSignalsForQueryRouting, inferAdvisorQueryRouting } from "@/lib/ai/advisor/service"
import { buildKpiOwnerSignals, buildSlaTicketSignals, normalizeAdvisorSignalMetric } from "@/lib/ai/advisor/signals"
import type { AdvisorCapability, AdvisorSignal } from "@/lib/ai/advisor/types"

const supportCapability: AdvisorCapability = {
  key: "support",
  label: "Ticketing",
  moduleId: "support",
  status: "active",
}

const kpiCapability: AdvisorCapability = {
  key: "kpi",
  label: "KPI / Managers",
  moduleId: "analytics",
  status: "active",
}

describe("Advisor signal routing", () => {
  it("keeps open SLA tickets when the question infers a minutes metric", () => {
    const now = new Date("2026-07-02T10:00:00.000Z")
    const [signal] = buildSlaTicketSignals([
      {
        id: "ticket-1",
        ticketNumber: "TCK-001",
        subject: "Urgent complaint",
        priority: "medium",
        status: "open",
        assignedTo: null,
        slaFirstResponseDueAt: new Date("2026-07-02T09:30:00.000Z"),
        slaDueAt: new Date("2026-07-02T12:00:00.000Z"),
        firstResponseAt: null,
        escalationLevel: 0,
        createdAt: new Date("2026-07-02T08:00:00.000Z"),
        company: { name: "Acme" },
      },
    ], [supportCapability], now)

    const normalized = normalizeAdvisorSignalMetric(signal)
    const routing = inferAdvisorQueryRouting("Hansı SLA riskləri açıqdır?", [normalized])
    const routedSignals = filterSignalsForQueryRouting([normalized], routing)

    expect(routing.intent).toBe("support")
    expect(routing.metricKinds).toContain("minutes")
    expect(normalized.metric).toMatchObject({
      kind: "minutes",
      label: "First response breach minutes",
      value: 30,
    })
    expect(routedSignals).toHaveLength(1)
  })

  it("keeps escalated open tickets in SLA questions even when they have no SLA timestamp", () => {
    const signal: AdvisorSignal = normalizeAdvisorSignalMetric({
      id: "support:escalated:ticket-2",
      domain: "support",
      domainLabel: "Ticketing",
      entityType: "ticket",
      entityId: "ticket-2",
      title: "TCK-002 is escalated and unresolved",
      summary: "Ticket is at escalation level 1 and remains open.",
      severity: "critical",
      ownerId: "support-1",
      detectedAt: "2026-07-02T10:00:00.000Z",
      facts: [
        { label: "Status", value: "open" },
        { label: "Escalation level", value: "1" },
      ],
      sources: [{ label: "TCK-002", entityType: "ticket", entityId: "ticket-2", href: "/tickets/ticket-2" }],
      recommendedActions: [],
    })

    const routing = inferAdvisorQueryRouting("Hansı SLA riskləri açıqdır?", [signal])
    const routedSignals = filterSignalsForQueryRouting([signal], routing)

    expect(signal.metric?.kind).toBe("count")
    expect(routedSignals).toEqual([signal])
  })

  it("keeps aging open tickets without SLA timestamps in SLA questions", () => {
    const now = new Date("2026-07-02T10:00:00.000Z")
    const [signal] = buildSlaTicketSignals([
      {
        id: "ticket-old",
        ticketNumber: "TCK-OLD",
        subject: "Long open ticket",
        priority: "medium",
        status: "open",
        assignedTo: "support-1",
        slaFirstResponseDueAt: null,
        slaDueAt: null,
        firstResponseAt: null,
        escalationLevel: 0,
        createdAt: new Date("2026-06-28T10:00:00.000Z"),
        company: { name: "Acme" },
      },
    ], [supportCapability], now)

    const normalized = normalizeAdvisorSignalMetric(signal)
    const routing = inferAdvisorQueryRouting("Hansı SLA riskləri açıqdır?", [normalized])
    const routedSignals = filterSignalsForQueryRouting([normalized], routing)

    expect(normalized.title).toBe("TCK-OLD is aging")
    expect(normalized.summary).toContain("4 days")
    expect(normalized.metric).toMatchObject({
      kind: "days",
      label: "Age days",
      value: 4,
    })
    expect(routedSignals).toHaveLength(1)
  })

  it("creates manager-plan risk signals for a single unclosed overdue task", () => {
    const now = new Date("2026-07-02T10:00:00.000Z")
    const signals = buildKpiOwnerSignals([
      {
        id: "task-1",
        assignedTo: "user-1",
        status: "open",
        dueDate: new Date("2026-07-01T10:00:00.000Z"),
        createdAt: new Date("2026-07-01T08:00:00.000Z"),
        completedAt: null,
        assignee: { name: "Hector", email: "hector@example.com" },
      },
    ], [kpiCapability], now, new Date("2026-07-01T00:00:00.000Z"))

    const normalized = signals.map((signal) => normalizeAdvisorSignalMetric(signal))
    const routing = inferAdvisorQueryRouting("Hansı menecerlər plandan geri qalır?", normalized)
    const routedSignals = filterSignalsForQueryRouting(normalized, routing)

    expect(routing.intent).toBe("kpi")
    expect(normalized).toHaveLength(1)
    expect(normalized[0].title).toBe("Hector has 1 overdue task")
    expect(routedSignals).toHaveLength(1)
  })

  it("keeps task-domain overdue work in manager-plan questions", () => {
    const signal: AdvisorSignal = normalizeAdvisorSignalMetric({
      id: "tasks:overdue:task-2",
      domain: "tasks",
      domainLabel: "Tasks",
      entityType: "task",
      entityId: "task-2",
      title: "Follow up customer is overdue",
      summary: "Task is overdue and still open.",
      severity: "high",
      ownerId: "manager-1",
      ownerLabel: "Hector",
      detectedAt: "2026-07-02T10:00:00.000Z",
      facts: [
        { label: "Status", value: "open" },
        { label: "Overdue days", value: "3" },
      ],
      sources: [{ label: "Follow up customer", entityType: "task", entityId: "task-2", href: "/tasks/task-2" }],
      recommendedActions: [],
    })

    const routing = inferAdvisorQueryRouting("Hansı menecerlər plandan geri qalır?", [signal])
    const routedSignals = filterSignalsForQueryRouting([signal], routing)

    expect(routing.intent).toBe("kpi")
    expect(routing.domains).toEqual(["kpi", "tasks"])
    expect(routedSignals).toEqual([signal])
  })
})
