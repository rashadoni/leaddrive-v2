import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The agent's notice of a joint visit (owner, 2026-10-20: «должно придти
 * уведомление тому агенту… как всплывающее окно»): a bell line and a push in
 * the channel the app pops up, in the agent's language. Which rows exist on a
 * real database is asserted in mtm-joint-visit-postgres.test.ts; this file pins
 * what goes to Firebase, which that suite cannot see.
 */

const db = vi.hoisted(() => ({
  agents: new Map<string, { name: string; user: { preferredLanguage: string | null } | null }>(),
  notifications: [] as Array<Record<string, unknown>>,
}))
const push = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mtmAgent: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => db.agents.get(where.id) ?? null),
    },
    mtmNotification: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { db.notifications.push(data); return data }),
    },
  },
}))
vi.mock("@/lib/mtm/push-notify", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/mtm/push-notify")>(),
  notifyAgents: vi.fn(async (input: Record<string, unknown>) => { push.calls.push(input); return { sent: 1, failed: 0, retired: 0 } }),
}))

import { jointPlanNotice, jointVisitLocale, notifyAgentOfJointVisit, notifyAgentOfJointVisitPlan } from "@/lib/mtm/joint-visit-notify"

beforeEach(() => {
  db.agents.clear()
  db.notifications.length = 0
  push.calls.length = 0
  db.agents.set("manager-1", { name: "Fictional Narmin", user: null })
})

describe("the agent hears that his manager goes on visits with him", () => {
  it("pops up in the team-messages channel, open app included, and points a tap at the route", async () => {
    db.agents.set("agent-1", { name: "Fictional Elvin", user: { preferredLanguage: "ru" } })
    await notifyAgentOfJointVisit({ organizationId: "org-1", managerAgentId: "manager-1", agentId: "agent-1", sessionId: "session-1" })

    expect(push.calls).toHaveLength(1)
    expect(push.calls[0]).toMatchObject({
      organizationId: "org-1",
      agentIds: ["agent-1"],
      title: "Fictional Narmin сегодня с вами на визитах",
      body: "При начале визита ответьте «Да, вместе с руководителем» — тогда руководитель сможет его оценить.",
      channelId: "team-messages",
      data: { target: "Route", channel: "team-messages", jointSessionId: "session-1" },
    })
    expect(db.notifications).toEqual([{
      organizationId: "org-1",
      agentId: "agent-1",
      type: "info",
      title: "Fictional Narmin сегодня с вами на визитах",
      body: "При начале визита ответьте «Да, вместе с руководителем» — тогда руководитель сможет его оценить.",
      metadata: { domain: "route", event: "joint_visit_session", jointSessionId: "session-1", managerAgentId: "manager-1" },
    }])
  })

  it("speaks Azerbaijani to an agent without a login, and says nothing about any client", async () => {
    db.agents.set("agent-2", { name: "Fictional Aysel", user: null })
    await notifyAgentOfJointVisit({ organizationId: "org-1", managerAgentId: "manager-1", agentId: "agent-2", sessionId: "session-2" })
    expect(push.calls[0]).toMatchObject({ title: "Fictional Narmin bu gün sizinlə birgə vizitdədir" })
    expect(Object.keys(push.calls[0].data as object).sort()).toEqual(["channel", "jointSessionId", "target"])
    expect(jointVisitLocale("en")).toBe("en")
    expect(jointVisitLocale("de")).toBe("az")
  })

  it("writes nothing for a card that is not there", async () => {
    await notifyAgentOfJointVisit({ organizationId: "org-1", managerAgentId: "manager-1", agentId: "missing", sessionId: "session-3" })
    expect(db.notifications).toEqual([])
    expect(push.calls).toEqual([])
  })
})

describe("the agent hears where his manager plans to go with him (2026-10-30)", () => {
  const clients = [
    { customerName: "Fictional Clinic", contactName: "Dr. Fictional Leyla" },
    { customerName: "Fictional Pharmacy", contactName: null },
  ]

  it("names the clients in the bell and only how many in the push, which shows on a locked screen", async () => {
    db.agents.set("agent-1", { name: "Fictional Elvin", user: { preferredLanguage: "ru" } })
    await notifyAgentOfJointVisitPlan({
      organizationId: "org-1",
      managerAgentId: "manager-1",
      agentId: "agent-1",
      kind: "planned",
      date: "2026-10-31",
      today: "2026-10-30",
      planIds: ["plan-1", "plan-2"],
      clients,
    })
    expect(db.notifications).toEqual([{
      organizationId: "org-1",
      agentId: "agent-1",
      type: "info",
      title: "Fictional Narmin завтра идёт с вами на визит",
      body: "Dr. Fictional Leyla (Fictional Clinic), Fictional Pharmacy. В маршруте отмечено «Совместный визит»; при начале визита ответьте «Да, вместе с руководителем».",
      metadata: { domain: "route", event: "joint_visit_planned", date: "2026-10-31", jointVisitPlanIds: ["plan-1", "plan-2"], managerAgentId: "manager-1" },
    }])
    expect(push.calls).toHaveLength(1)
    expect(push.calls[0]).toMatchObject({
      title: "Fictional Narmin завтра идёт с вами на визит",
      channelId: "team-messages",
      data: { target: "Route", channel: "team-messages", event: "joint_visit_planned", date: "2026-10-31" },
    })
    expect(JSON.stringify(push.calls[0])).not.toMatch(/Fictional (Clinic|Pharmacy|Leyla)/)
  })

  it("says the day as a person would: today, tomorrow, or the date", () => {
    const at = (date: string) => jointPlanNotice("az", { kind: "planned", managerName: "Saida", date, today: "2026-10-30", clients }).title
    expect(at("2026-10-30")).toBe("Saida bu gün sizinlə birgə vizitə gedəcək")
    expect(at("2026-10-31")).toBe("Saida sabah sizinlə birgə vizitə gedəcək")
    expect(at("2026-11-04")).toBe("Saida 04.11 sizinlə birgə vizitə gedəcək")
    expect(jointPlanNotice("en", { kind: "cancelled", managerName: "Saida", date: "2026-10-30", today: "2026-10-30", clients: clients.slice(1) }))
      .toEqual({ title: "Saida cancelled the joint visit today", body: "Fictional Pharmacy — no longer a joint visit.", push: "Saida cancelled the joint visit today" })
  })

  it("writes nothing when nothing new was planned", async () => {
    db.agents.set("agent-1", { name: "Fictional Elvin", user: null })
    await notifyAgentOfJointVisitPlan({ organizationId: "org-1", managerAgentId: "manager-1", agentId: "agent-1", kind: "planned", date: "2026-10-30", today: "2026-10-30", planIds: [], clients: [] })
    expect(db.notifications).toEqual([])
    expect(push.calls).toEqual([])
  })
})
