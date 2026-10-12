import { readFileSync } from "node:fs"
import path from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * «Клиент здесь»: who is told that an agent's request is waiting, and how.
 *
 * Owner, 2026-10-12, having sent the first request from a phone: «уведомление
 * где теперь для менеджера… оно должно быть заметным… агент может быть рядом с
 * клиентом, и чтоб долго не ждать». Until then the only sign was a «1» on a
 * tab of the routes page.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mtmAgent: { findMany: vi.fn(), findFirst: vi.fn() },
    user: { findMany: vi.fn() },
  },
}))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }))
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/mtm/route-permissions")>(),
  resolveMtmRouteActor: vi.fn(),
}))

import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { locationRequestReviewers, notifyLocationRequestReviewers } from "@/lib/mtm/customer-location-request-notify"
import {
  MTM_LOCATION_REQUEST_NOTIFICATION_ENTITY,
  MTM_LOCATION_REQUEST_NOTIFICATION_KIND,
  MTM_LOCATION_REQUEST_NOTIFICATION_URL,
  locationRequestNotificationText,
} from "@/lib/mtm/customer-location-request-notification"
import { ENTITY_TO_MODULE, NOTIFICATION_KINDS, deriveSection } from "@/lib/notifications/taxonomy"
import { DEFAULT_SECTION_PUSH, shouldPush } from "@/lib/notifications/prefs"
import { attentionItemHref } from "@/lib/mtm/panel-attention"

const ORG = "org-1"
const ASKER = "agent-asker"

type Actor = { agentId: string | null; role: "ADMIN" | "MANAGER" | "SUPERVISOR" | "AGENT"; scopedAgentIds: string[] | null }
const USERS = [
  { id: "u-director", role: "admin", preferredLanguage: "az" },
  { id: "u-manager-own", role: "manager", preferredLanguage: "ru" },
  { id: "u-manager-other", role: "manager", preferredLanguage: null },
  { id: "u-supervisor-self", role: "sales", preferredLanguage: null },
  { id: "u-card-agent", role: "sales", preferredLanguage: null },
  { id: "u-no-card", role: "manager", preferredLanguage: null },
]
const ACTORS: Record<string, Actor | null> = {
  "u-director": { agentId: null, role: "ADMIN", scopedAgentIds: null },
  "u-manager-own": { agentId: "card-m1", role: "MANAGER", scopedAgentIds: [ASKER, "agent-2"] },
  // Another territory: the asker is not theirs.
  "u-manager-other": { agentId: "card-m2", role: "MANAGER", scopedAgentIds: ["agent-9"] },
  // The asker's own card, were it a supervisor's: nobody decides their own request.
  "u-supervisor-self": { agentId: ASKER, role: "SUPERVISOR", scopedAgentIds: [ASKER] },
  "u-card-agent": { agentId: "card-a", role: "AGENT", scopedAgentIds: ["card-a"] },
  "u-no-card": null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ userId: "u-manager-own" }, { userId: "u-manager-other" }, { userId: "u-supervisor-self" }, { userId: null }] as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ name: "Nigar Əliyeva" } as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue(USERS as never)
  vi.mocked(resolveMtmRouteActor).mockImplementation(async (_client, params) => ACTORS[params.userId] as never)
  vi.mocked(createNotification).mockImplementation(async (input) => ({ id: `n-${input.userId}` }) as never)
})

describe("who may decide the request is who is told", () => {
  it("asks the decision route's own rule about every candidate", async () => {
    const reviewers = await locationRequestReviewers({ organizationId: ORG, requestedByAgentId: ASKER })
    expect(reviewers).toEqual([
      { userId: "u-director", preferredLanguage: "az" },
      { userId: "u-manager-own", preferredLanguage: "ru" },
    ])
    // Each is resolved as the decision route resolves a person at a browser: by user, with the web role.
    expect(vi.mocked(resolveMtmRouteActor).mock.calls.map(([, params]) => params)).toEqual(
      USERS.map((user) => ({ organizationId: ORG, userId: user.id, webRole: user.role })),
    )
  })

  it("looks only among this organization's active people: administrators and holders of a reviewer card", async () => {
    await locationRequestReviewers({ organizationId: ORG, requestedByAgentId: ASKER })
    expect(vi.mocked(prisma.mtmAgent.findMany).mock.calls[0][0]).toMatchObject({
      where: { organizationId: ORG, status: "ACTIVE", role: { in: ["ADMIN", "MANAGER", "SUPERVISOR"] }, userId: { not: null } },
    })
    const where = vi.mocked(prisma.user.findMany).mock.calls[0][0]!.where as Record<string, unknown>
    expect(where).toMatchObject({ organizationId: ORG, isActive: true, anonymizedAt: null })
    expect(where.OR).toEqual([
      { role: { in: ["admin", "superadmin"] } },
      { id: { in: ["u-manager-own", "u-manager-other", "u-supervisor-self"] } },
    ])
  })
})

describe("the notification", () => {
  const send = () => notifyLocationRequestReviewers({
    organizationId: ORG, requestId: "req-1", requestedByAgentId: ASKER, customerName: "Aptek Nümunə", movedMeters: 9_666,
  })

  it("goes to each of them once: in the bell, as a push and by email, in their own language", async () => {
    expect(await send()).toBe(2)
    const calls = vi.mocked(createNotification).mock.calls.map(([input]) => input)
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call).toMatchObject({
        organizationId: ORG,
        type: "warning",
        entityType: "mtm_location_request",
        entityId: "req-1",
        kind: "mtm.locationRequest.submitted",
        push: true,
        email: true,
        // The phone may repeat its sending: one row per person per request.
        idempotencyKey: "mtm-location-request-submitted:req-1",
      })
    }
    expect(calls[0]).toMatchObject({
      userId: "u-director",
      title: "Müştəri ünvanı: agent qərar gözləyir",
      message: "Nigar Əliyeva «Aptek Nümunə» müştərisinin yanındadır və nöqtənin yerində olmadığını bildirir — əvvəlkindən 9,7 km aralıda. Yeni yeri qəbul edin və ya olduğu kimi saxlayın.",
    })
    expect(calls[1]).toMatchObject({
      userId: "u-manager-own",
      title: "Адрес клиента: агент ждёт решения",
      message: "Nigar Əliyeva у клиента «Aptek Nümunə» и сообщает, что точка стоит не там — в 9,7 км от прежней. Примите новое место или оставьте как было.",
    })
  })

  it("never costs the agent his request: a failure is swallowed and nobody is counted", async () => {
    vi.mocked(prisma.user.findMany).mockRejectedValue(new Error("connection lost"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(send()).resolves.toBe(0)
    expect(createNotification).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("does not count a row that could not be written", async () => {
    vi.mocked(createNotification).mockResolvedValueOnce(null as never)
    expect(await send()).toBe(1)
  })
})

describe("what it says", () => {
  const input = { agentName: "Nigar", customerName: "Klinika" }

  it("gives metres under a kilometre and kilometres above, in the reader's notation", () => {
    expect(locationRequestNotificationText("ru", { ...input, movedMeters: 340 }).message).toContain("в 340 м от прежней")
    expect(locationRequestNotificationText("ru", { ...input, movedMeters: 1_240 }).message).toContain("в 1,2 км от прежней")
    expect(locationRequestNotificationText("az", { ...input, movedMeters: 1_240 }).message).toContain("əvvəlkindən 1,2 km aralıda")
    expect(locationRequestNotificationText("en", { ...input, movedMeters: 1_240 }).message).toContain("1.2 km from where it stands")
  })

  it("says so when the customer had no pin at all, instead of a distance", () => {
    expect(locationRequestNotificationText("ru", { ...input, movedMeters: null }).message)
      .toBe("Nigar у клиента «Klinika»: точки на карте не было, агент показал, где клиент. Примите новое место или оставьте как было.")
    expect(locationRequestNotificationText("en", { ...input, movedMeters: null }).message).not.toMatch(/\d/)
  })

  it("falls back to the application's language for a reader who chose none", () => {
    expect(locationRequestNotificationText(null, { ...input, movedMeters: 50 }).title).toBe("Адрес клиента: агент ждёт решения")
    expect(locationRequestNotificationText("de", { ...input, movedMeters: 50 }).title).toBe("Адрес клиента: агент ждёт решения")
  })
})

describe("how it reaches the screen", () => {
  it("is a notification of the MTM module that opens the approvals queue — the address the Panel's row opens too", () => {
    expect(MTM_LOCATION_REQUEST_NOTIFICATION_ENTITY).toBe("mtm_location_request")
    expect(ENTITY_TO_MODULE[MTM_LOCATION_REQUEST_NOTIFICATION_ENTITY]).toBe("mtm")
    expect(deriveSection(MTM_LOCATION_REQUEST_NOTIFICATION_ENTITY)).toBe("Route & Field")
    expect(MTM_LOCATION_REQUEST_NOTIFICATION_URL).toBe("/mtm/routes?view=approvals")
    expect(attentionItemHref({ kind: "customerLocationRequests", date: null })).toBe(MTM_LOCATION_REQUEST_NOTIFICATION_URL)
  })

  it("is shown although «Route & Field» is off by default — until the person switches off this very kind", () => {
    const section = "Route & Field"
    expect(DEFAULT_SECTION_PUSH[section]).toBe(false)
    // An order notice of the same section stays opt-in…
    expect(shouldPush({}, section, "order.created")).toBe(false)
    // …the waiting agent is not.
    expect(shouldPush({}, section, MTM_LOCATION_REQUEST_NOTIFICATION_KIND)).toBe(true)
    expect(shouldPush({ [section]: { push: false } }, section, MTM_LOCATION_REQUEST_NOTIFICATION_KIND)).toBe(true)
    expect(shouldPush({ [section]: { push: true, types: { [MTM_LOCATION_REQUEST_NOTIFICATION_KIND]: false } } }, section, MTM_LOCATION_REQUEST_NOTIFICATION_KIND)).toBe(false)
  })

  it("has a switch of its own in the notification settings, named in every language", () => {
    expect(NOTIFICATION_KINDS.find((kind) => kind.kind === MTM_LOCATION_REQUEST_NOTIFICATION_KIND)).toEqual({
      kind: "mtm.locationRequest.submitted", entityType: "mtm_location_request", section: "Route & Field",
    })
    for (const locale of ["ru", "en", "az"]) {
      const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8"))
      const label = Object.values(messages as Record<string, { kinds?: Record<string, string> }>)
        .map((namespace) => namespace?.kinds?.mtm_locationRequest_submitted)
        .find(Boolean)
      expect(label, locale).toBeTruthy()
      expect(messages.notifications.openRequest, locale).toBeTruthy()
    }
  })
})
