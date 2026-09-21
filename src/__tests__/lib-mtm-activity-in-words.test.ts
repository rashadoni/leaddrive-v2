import { readFileSync } from "node:fs"
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

    const rows = vi.mocked(prisma.mtmAuditLog.create).mock.calls.map(([query]) => (query as { data: Record<string, unknown> }).data)
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
