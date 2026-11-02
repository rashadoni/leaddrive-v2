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
  // 2026-11-01, Zeytun Pharma: read as «Əməliyyat · Qeyd» (owner: «мало информации»).
  "CONTACT_CREATE", "FIELD_ORGANIZATION_CREATE", "MOBILE_LOGIN_CODE_SENT", "MOBILE_PASSWORD_SET_BY_CODE",
  "MOBILE_LOGIN_CODE_ACCEPTED", "CONTACT_BULK_ASSIGN", "MTM_ATTENDANCE_CALENDAR_ADDED", "MTM_ATTENDANCE_SCREEN_PAIRING_STARTED",
  "MTM_ATTENDANCE_PARTICIPATION_CHANGED", "MTM_ATTENDANCE_EMPLOYEE_CREATED", "MTM_ATTENDANCE_EMPLOYMENT_RECORDED",
  "WORKFORCE_EMPLOYMENT_EVENT_RECORDED", "CUSTOMER_LOCATION_REQUEST", "MTM_ATTENDANCE_REMINDER_POLICY_CHANGED",
  "MTM_ATTENDANCE_EXPLANATION_DECIDED", "MTM_ATTENDANCE_EXPLANATION_ANSWERED", "MTM_ATTENDANCE_EXPLANATION_REQUESTED",
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

describe("the journal says the facts of a change (owner, 2026-11-01: «мало информации»)", () => {
  const t = (key: string, values?: Record<string, unknown>) => {
    let node: unknown = messages.az
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part]
    const raw = typeof node === "string" ? node : key
    const plural = raw.match(/^\{count, plural,.* other \{# ([^}]*)\}\}$/)
    if (plural) return `${values?.count} ${plural[1]}`
    return raw.replace(/\{(\w+)\}/g, (_m, name) => String(values?.[name] ?? ""))
  }

  it("a calendar day: its date, its name and its kind", () => {
    expect(activityDataSummary({ action: "MTM_ATTENDANCE_CALENDAR_ADDED", newData: { date: "2026-12-31", kind: "PUBLIC_HOLIDAY", name: "Həmrəylik Günü" } }, t, "az"))
      .toMatch(/^31 dekabr · Həmrəylik Günü · bayram$/)
  })

  it("an explanation: the day, lateness or absence, and how it was decided", () => {
    expect(activityDataSummary({ action: "MTM_ATTENDANCE_EXPLANATION_REQUESTED", newData: { date: "2026-10-30", kind: "LATE" } }, t, "az")).toBe("30 oktyabr · gecikmə")
    expect(activityDataSummary({ action: "MTM_ATTENDANCE_EXPLANATION_DECIDED", newData: { status: "REJECTED" } }, t, "az")).toBe("rədd edildi")
  })

  it("a sign-in by code: the phone only as it was masked, and how the password was set", () => {
    expect(activityDataSummary({ action: "MOBILE_LOGIN_CODE_SENT", newData: { phone: "+99410•••7110", messageId: "wamid.X" } }, t, "az")).toBe("+99410•••7110")
    expect(activityDataSummary({ action: "MOBILE_LOGIN_CODE_SENT", newData: { phone: "+994105107110" } }, t, "az")).toBeNull()
    expect(activityDataSummary({ action: "MOBILE_PASSWORD_SET_BY_CODE", newData: { reason: "whatsapp_code" } }, t, "az")).toBe("WhatsApp kodu ilə")
  })

  it("clients handed over: how many", () => {
    expect(activityDataSummary({ action: "CONTACT_BULK_ASSIGN", newData: { contactIds: ["a", "b", "c"] } }, t, "az")).toBe("3 müştəri")
  })

  it("the page shows who, what, to whom and the facts — and no «Qeyd» standing in for nothing", () => {
    const page = readFileSync("src/app/(dashboard)/mtm/activity/page.tsx", "utf8")
    for (const id of ["mtm-activity-time", "mtm-activity-who", "mtm-activity-action", "mtm-activity-subject", "mtm-activity-details"]) expect(page).toContain(`data-testid="${id}"`)
    expect(page).toContain("if (mtmActivityEntityKey(l.entity)) return mtmActivityEntityText(l, t)")
    // The time column: formatDate in Azerbaijani has no hours, and it stood empty on prod.
    expect(page).toContain("const timeOf = (iso: string) => formatTime(iso, locale,")
  })

  it("writes the hour of a row in Azerbaijani too", async () => {
    const { formatTime } = await import("@/lib/format-date")
    expect(formatTime("2026-11-01T12:40:59Z", "az", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Baku" })).toBe("16:40")
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
