import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The agent's notice of a task given to him (owner, 2026-10-20: «должно было
 * придти всплывающее окно как задача в приложение»): what goes to Firebase,
 * which mtm-task-notice-postgres.test.ts cannot see, and how the deadline is
 * said. Which bell rows exist after the real handlers is asserted there.
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

import { notifyAgentOfAssignedTask, taskDueWords } from "@/lib/mtm/task-assigned-notify"

// 2026-10-20 15:00 in Baku (UTC+4).
const NOW = new Date("2026-10-20T11:00:00.000Z")
const BAKU = "Asia/Baku"

beforeEach(() => {
  db.agents.clear()
  db.notifications.length = 0
  push.calls.length = 0
  db.agents.set("manager-1", { name: "Fictional Kamran", user: null })
})

describe("the agent hears of a task given to him", () => {
  it("pops up in the team-messages channel with who gave it, its words and its deadline", async () => {
    db.agents.set("agent-1", { name: "Fictional Anar", user: { preferredLanguage: "ru" } })
    await notifyAgentOfAssignedTask({
      organizationId: "org-1",
      taskId: "task-1",
      agentId: "agent-1",
      taskTitle: "Взять подпись на договоре",
      dueDate: new Date("2026-10-21T14:00:00.000Z"),
      timezone: BAKU,
      giverAgentId: "manager-1",
      giverName: "web login name",
      now: NOW,
    })

    expect(push.calls).toHaveLength(1)
    expect(push.calls[0]).toMatchObject({
      organizationId: "org-1",
      agentIds: ["agent-1"],
      title: "Новая задача от Fictional Kamran",
      body: "Взять подпись на договоре · срок завтра до 18:00",
      channelId: "team-messages",
      data: { target: "Tasks", channel: "team-messages", assignedTaskId: "task-1" },
    })
    expect(db.notifications).toEqual([{
      organizationId: "org-1",
      agentId: "agent-1",
      type: "task",
      title: "Новая задача от Fictional Kamran",
      body: "Взять подпись на договоре · срок завтра до 18:00",
      metadata: { domain: "task", event: "task_assigned", assignedTaskId: "task-1", giverAgentId: "manager-1" },
    }])
  })

  it("names an administrator without a field card by his login, and speaks Azerbaijani to an agent without one", async () => {
    db.agents.set("agent-2", { name: "Fictional Aysel", user: null })
    await notifyAgentOfAssignedTask({
      organizationId: "org-1",
      taskId: "task-2",
      agentId: "agent-2",
      taskTitle: "Əlavə məlumat al",
      dueDate: null,
      timezone: BAKU,
      giverAgentId: null,
      giverName: "Fictional Admin",
      now: NOW,
    })
    expect(push.calls[0]).toMatchObject({ title: "Fictional Admin sizə yeni tapşırıq verdi", body: "Əlavə məlumat al" })
  })

  it("sends nothing for a task the agent gave himself, or for a card that is gone", async () => {
    db.agents.set("agent-1", { name: "Fictional Anar", user: null })
    await notifyAgentOfAssignedTask({
      organizationId: "org-1", taskId: "task-3", agentId: "agent-1", taskTitle: "Own", dueDate: null,
      timezone: BAKU, giverAgentId: "agent-1", giverName: "Fictional Anar", now: NOW,
    })
    await notifyAgentOfAssignedTask({
      organizationId: "org-1", taskId: "task-4", agentId: "no-such-card", taskTitle: "Lost", dueDate: null,
      timezone: BAKU, giverAgentId: "manager-1", giverName: null, now: NOW,
    })
    expect(push.calls).toEqual([])
    expect(db.notifications).toEqual([])
  })
})

describe("the deadline in words, in the organization's timezone", () => {
  it("says today, tomorrow or the date, and the time only when someone chose one", () => {
    expect(taskDueWords("ru", new Date("2026-10-20T14:00:00.000Z"), NOW, BAKU)).toBe("сегодня до 18:00")
    // Midnight in Baku is a date without a time (task-due.ts, C11).
    expect(taskDueWords("ru", new Date("2026-10-20T20:00:00.000Z"), NOW, BAKU)).toBe("завтра")
    expect(taskDueWords("az", new Date("2026-10-21T14:00:00.000Z"), NOW, BAKU)).toBe("sabah 18:00")
    expect(taskDueWords("en", new Date("2026-10-21T14:00:00.000Z"), NOW, BAKU)).toBe("tomorrow 18:00")
    expect(taskDueWords("ru", new Date("2026-10-23T14:00:00.000Z"), NOW, BAKU)).toBe("23 окт. до 18:00")
  })
})
