import { readFileSync } from "node:fs"
import { createTranslator } from "next-intl"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

import { prisma } from "@/lib/prisma"
import { currentAuditActorUserId, runWithAuditActor } from "@/lib/audit-actor-context"
import { writeMtmAudit } from "@/lib/mtm-audit"
import {
  actionLabelKey,
  activityActorName,
  activityDataSummary,
  activityDetails,
  canonicalAction,
} from "@/lib/mtm/activity-actions"

const messages = Object.fromEntries(["az", "ru", "en"].map((locale) => [
  locale,
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmActivity,
]))

/**
 * Audit 2026-09-21: the MTM journal read «? · Действие · Система · Запись».
 * Every action below was written on prod in the 30 days before the audit.
 */
const PROD_ACTIONS = [
  "ROUTE_DAY_CLOSE", "MOBILE_LOGIN", "ROUTE_CREATE", "ROUTE_UPDATE", "CUSTOMER_UPDATE", "AGENT_UPDATE",
  "CHECK_OUT", "MESSAGE_BROADCAST", "FIELD_ORGANIZATION_UPDATE", "VISIT_UPDATE", "WORKDAY_START",
  "ROUTE_DELETE", "ROUTE_PUBLISH", "WORKDAY_FINISH", "PHOTO_UPLOAD", "CHECK_IN", "SETTINGS_UPDATE",
  "ROUTE_START", "WORKDAY_PAUSE", "WORKDAY_RESUME", "check_in", "ORGANIZATION_BULK_ASSIGN", "PHOTO_DELETE",
  "ROUTE_COMPLETE", "TASK_UPDATE", "MOBILE_LOGIN_FAILED", "FIELD_PRODUCT_PRESENTATION_UPLOAD", "upload_photo",
  "CUSTOMER_CREATE", "CUSTOMER_DELETE", "FIELD_ASSIGNMENT_UPSERT", "ORGANIZATION_BULK_UNASSIGN",
  "VISIT_ACTION_COMPLETE", "VISIT_RESULT_UPDATE", "check_out", "complete_task", "create_order", "login",
  "resolve_alert", "AGENT_CREATE", "WORKDAY_REOPEN", "WORKDAY_REOPEN_UNDO", "HRM_REQUEST_DECISION",
]

describe("the activity journal in words", () => {
  it("names every action written on prod, in all three languages", () => {
    const unnamed = PROD_ACTIONS.filter((action) => actionLabelKey(action) === "action.unknown")
    expect(unnamed).toEqual([])
    const missing: string[] = []
    for (const locale of ["az", "ru", "en"]) {
      for (const action of PROD_ACTIONS) {
        const key = actionLabelKey(action).slice("action.".length)
        if (typeof messages[locale].action[key] !== "string") missing.push(`${locale}.${key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it("reads the first mobile writers' lowercase verbs as the canonical actions", () => {
    expect(canonicalAction("check_in")).toBe("CHECK_IN")
    expect(canonicalAction("upload_photo")).toBe("PHOTO_UPLOAD")
    expect(canonicalAction("resolve_alert")).toBe("ALERT_RESOLVE")
    expect(canonicalAction("CHECK_OUT")).toBe("CHECK_OUT")
  })

  it("says who acted: the office user, else the employee, else that nobody wrote it down", () => {
    const t = (key: string) => (key === "actorNotRecorded" ? "Кто — не записано" : key)
    expect(activityActorName({ actor: { userId: "u", name: "Rashad" }, agent: { name: "Anar" } }, t)).toBe("Rashad")
    expect(activityActorName({ actor: null, agent: { name: "Anar" } }, t)).toBe("Anar")
    expect(activityActorName({ actor: null, agent: null }, t)).toBe("Кто — не записано")
  })

  it("summarizes a broadcast, a bulk assignment and an upload by their own facts", () => {
    const t = (key: string, values?: Record<string, unknown>) => `${key}:${values?.count ?? ""}`
    expect(activityDataSummary({ action: "MESSAGE_BROADCAST", newData: { recipientAgentIds: ["a", "b", "c"] } }, t)).toBe("detailRecipients:3")
    expect(activityDataSummary({ action: "ORGANIZATION_BULK_ASSIGN", newData: { changed: 12 } }, t)).toBe("detailOrganizations:12")
    expect(activityDataSummary({ action: "FIELD_PRODUCT_PRESENTATION_UPLOAD", newData: { title: " Omega 3 " } }, t)).toBe("Omega 3")
    expect(activityDataSummary({ action: "CHECK_IN", newData: {} }, t)).toBeNull()
    for (const locale of ["az", "ru", "en"]) {
      expect(messages[locale].detailRecipients).toContain("{count, plural,")
      expect(messages[locale].detailOrganizations).toContain("{count, plural,")
    }
    expect(messages.ru.detailRecipients).toContain("few {")
  })
})

/**
 * 2026-10-11: «Rashad Rahimov · Агент удалён · Сотрудник» — removed whom? The
 * row's link to the employee (`agentId`) is cleared with him; his name stays
 * in the snapshot the writer left. Rows are shaped as the activity API answers.
 */
describe("a row about an employee names the employee", () => {
  const translator = (locale: "az" | "ru" | "en") => {
    const t = createTranslator({
      locale,
      messages: JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")),
      namespace: "mtmActivity",
    }) as unknown as (key: string, values?: Record<string, unknown>) => string
    return t
  }
  const removed = (oldData: unknown) => ({
    id: "log-1", action: "AGENT_DELETE", entity: "agent", entityId: "agent-gone", metadataKind: "agent_delete",
    agentId: null, agent: null, actorUserId: "admin-user", actor: { userId: "admin-user", name: "Rashad Rahimov" },
    subject: { customerName: null, visitId: null, routeId: null },
    oldData, newData: null,
  })

  it.each(["az", "ru", "en"] as const)("%s: the removed employee by the name his card had, his id in the tooltip", (locale) => {
    const card = { id: "agent-gone", name: " Anar Məmmədov ", email: "anar@example.com", role: "AGENT" }
    expect(activityDetails(removed(card), translator(locale))).toEqual({ label: "Anar Məmmədov", title: "agent-gone" })
  })

  it.each([
    ["az", "Əməkdaş"],
    ["ru", "Сотрудник"],
    ["en", "Agent"],
  ] as const)("%s: «%s» when the row kept no name — no snapshot, an empty one, a name that is not text", (locale, generic) => {
    const t = translator(locale)
    for (const snapshot of [null, undefined, {}, { name: "" }, { name: "  " }, { name: 7 }, ["Anar"], "Anar"]) {
      expect(activityDetails(removed(snapshot), t), JSON.stringify(snapshot)).toEqual({ label: generic, title: "agent-gone" })
    }
  })

  it("takes the name a change left: the «after» of an edit, else the card's «before»", () => {
    const t = (key: string) => key
    const before = { id: "a", name: "Anar Mamedov", role: "AGENT" }
    expect(activityDataSummary({ action: "AGENT_CREATE", newData: { name: "Anar Mamedov", role: "AGENT" } }, t)).toBe("Anar Mamedov")
    expect(activityDataSummary({ action: "AGENT_UPDATE", oldData: before, newData: { name: "Anar Məmmədov" } }, t)).toBe("Anar Məmmədov")
    expect(activityDataSummary({ action: "AGENT_UPDATE", oldData: before, newData: { status: "INACTIVE" } }, t)).toBe("Anar Mamedov")
    expect(activityDataSummary({ action: "AGENT_DELETE", oldData: before }, t)).toBe("Anar Mamedov")
  })

  it("is the name only — the card's labels and map colour never become the line", () => {
    const t = translator("ru")
    const notes = { tags: ["стажёр", "ночная смена"], mapColor: "teal" }
    expect(activityDetails(removed({ id: "agent-gone", name: "Anar Məmmədov", ...notes }), t).label).toBe("Anar Məmmədov")
    expect(activityDetails(removed({ id: "agent-gone", ...notes }), t).label).toBe("Сотрудник")
  })

  it("leaves other rows about an employee as they were — a snapshot's «name» there is not his", () => {
    const t = translator("ru")
    // A failed sign-in is still told by its kind, a sign-in by the object.
    expect(activityDetails({ action: "MOBILE_LOGIN_FAILED", entity: "agent", entityId: "a", metadataKind: "login_failed", newData: { name: "Pixel 8" } }, t))
      .toEqual({ label: "Неудачный вход", title: null })
    expect(activityDetails({ action: "MOBILE_LOGIN", entity: "agent", entityId: "a", newData: { name: "Pixel 8" } }, t))
      .toEqual({ label: "Сотрудник", title: "a" })
  })
})

describe("the audit writer records the office user of the request", () => {
  beforeEach(() => {
    vi.mocked(prisma.mtmAuditLog.create).mockReset().mockResolvedValue({} as never)
  })

  it("writes the signed-in session user, and nothing for an API key or a job", async () => {
    await runWithAuditActor({ userId: "user-1", principalType: "session" }, async () => {
      expect(currentAuditActorUserId()).toBe("user-1")
      await writeMtmAudit({ organizationId: "org", agentId: null, action: "CUSTOMER_UPDATE", entity: "customer", entityId: "c" })
    })
    await runWithAuditActor({ userId: "key-creator", principalType: "api_key" }, async () => {
      await writeMtmAudit({ organizationId: "org", agentId: null, action: "CUSTOMER_UPDATE", entity: "customer", entityId: "c" })
    })
    await writeMtmAudit({ organizationId: "org", agentId: null, action: "ROUTE_DAY_CLOSE", entity: "route", entityId: "r" })

    const rows = vi.mocked(prisma.mtmAuditLog.create).mock.calls.map(([query]: unknown[]) => (query as { data: Record<string, unknown> }).data)
    expect(rows[0].actorUserId).toBe("user-1")
    expect(rows[1]).not.toHaveProperty("actorUserId")
    expect(rows[2]).not.toHaveProperty("actorUserId")
    expect(currentAuditActorUserId()).toBeNull()
  })

  it("is set by the web route wrappers", () => {
    const wrappers = readFileSync("src/lib/with-rls.ts", "utf8")
    expect(wrappers.match(/runWithAuditActor\(/g)).toHaveLength(3)
  })
})
