/**
 * The contract jobs speak the reader's language (owner, 2026-10-17: switch the
 * contract reminders back on, «сначала перевести»).
 *
 * Every one of them used to be English for everybody: «Renewal alert:
 * CTR-0042» in an Azerbaijani team's bell, «[Action Required] Please sign» in
 * a customer's inbox. In the bell it is now the recipient's own language, the
 * organization's when none is set; a signer is outside the CRM, so the
 * e-mails speak the organization's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contractRenewalAlert: { findMany: vi.fn(), update: vi.fn() },
    contractApprovalStage: { findMany: vi.fn() },
    contractMilestone: { findMany: vi.fn() },
    esignSigner: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue({ id: "notif-1" }),
}))

vi.mock("@/lib/rls-context", () => ({
  enterRlsBypass: vi.fn(),
  runWithRlsBypass: vi.fn((fn: () => unknown) => fn()),
}))

import { POST as renewalAlerts } from "@/app/api/cron/renewal-alerts/route"
import { POST as approvalEscalations } from "@/app/api/cron/contract-approval-escalations/route"
import { POST as milestoneReminders } from "@/app/api/cron/contract-milestone-reminders/route"
import { POST as esignReminders } from "@/app/api/cron/esign-reminders/route"
import { prisma } from "@/lib/prisma"
import { createNotification } from "@/lib/notifications"
import { enterRlsBypass, runWithRlsBypass } from "@/lib/rls-context"
import {
  approvalOverdueText,
  contractRecipientLocale,
  milestoneReminderText,
  renewalAlertText,
  signingEmail,
} from "@/lib/contract-lifecycle/notification-text"

const CRON_SECRET = "contract-cron-secret"
const request = (path: string, secret = CRON_SECRET) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "x-cron-secret": secret } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("CRON_SECRET", CRON_SECRET)
  vi.stubEnv("ESIGN_SECRET", "esign-secret-for-tests-0123456789")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("who reads which language", () => {
  it("the recipient's own language first, then the organization's", () => {
    expect(contractRecipientLocale("ru", { language: "az" })).toBe("ru")
    expect(contractRecipientLocale(null, { language: "az" })).toBe("az")
    expect(contractRecipientLocale("klingon", { language: "en" })).toBe("en")
  })

  it("names the contract, the end date and the days left in each language", () => {
    const input = { contractNumber: "CTR-0042", title: "Xidmət müqaviləsi", company: "Xəzər Tikinti MMC", endDate: new Date("2026-11-30T00:00:00.000Z"), daysBeforeExpiry: 30 }
    expect(renewalAlertText("az", input)).toEqual({
      title: "Müqavilənin müddəti bitir: CTR-0042",
      message: "Xidmət müqaviləsi (Xəzər Tikinti MMC) — 30.11.2026 tarixində bitir — 30 gün qalıb.",
    })
    expect(renewalAlertText("ru", input).title).toBe("Срок договора истекает: CTR-0042")
    expect(renewalAlertText("en", input).message).toContain("30 days left")
    for (const locale of ["az", "ru", "en"] as const) {
      expect(renewalAlertText(locale, input).title).not.toContain("Renewal alert")
    }
  })

  it("says overdue or coming due, for the managers and for the one it is assigned to", () => {
    const due = new Date("2026-10-20T00:00:00.000Z")
    expect(milestoneReminderText("az", { label: "Avans ödənişi", contractTitle: "Təchizat", dueAt: due, overdue: true }).managers.title).toBe("Mərhələ gecikir: Avans ödənişi")
    expect(milestoneReminderText("ru", { label: "Аванс", contractTitle: "Поставка", dueAt: due, overdue: false }).owner.message).toContain("скоро наступает")
    expect(approvalOverdueText("az", { contractRef: "CTR-7", contractTitle: "Təchizat", stage: "Hüquq", level: 2 }).assignee.title).toBe("Qərarınız gözlənilir: «Hüquq»")
  })

  it("writes the signer's e-mail in the organization's language and escapes what people typed", () => {
    const email = signingEmail("az", { kind: "invitation", fullName: "Fərid <b>", subject: "Təchizat & xidmət", signingLink: "https://app.example/sign/abc", message: null })
    expect(email.subject).toBe("İmzanız gözlənilir: Təchizat & xidmət")
    expect(email.html).toContain("Fərid &lt;b&gt;")
    expect(email.html).toContain("Təchizat &amp; xidmət")
    expect(email.html).toContain("https://app.example/sign/abc")
    expect(email.html).not.toMatch(/Please sign|Review &amp; Sign/)
    const reminder = signingEmail("ru", { kind: "reminder", fullName: "Анна", subject: "NDA", signingLink: "https://app.example/sign/new" })
    expect(reminder.subject).toBe("Напоминание: ждём вашей подписи — NDA")
    expect(reminder.html).toContain("работает только она")
  })
})

describe("the renewal alert in the bell", () => {
  it("reaches each admin in their own language, the organization's for one without", async () => {
    vi.mocked(prisma.contractRenewalAlert.findMany).mockResolvedValue([{
      id: "alert-1",
      organizationId: "org-1",
      contractId: "contract-1",
      daysBeforeExpiry: 14,
      contract: { contractNumber: "CTR-0042", title: "Təchizat", endDate: new Date("2026-11-30T00:00:00.000Z"), company: { name: "Xəzər Tikinti MMC" } },
    }] as never)
    vi.mocked(prisma.contractRenewalAlert.update).mockResolvedValue({} as never)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "admin-ru", preferredLanguage: "ru" },
      { id: "admin-plain", preferredLanguage: null },
    ] as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: { language: "az" } } as never)

    const res = await renewalAlerts(request("/api/cron/renewal-alerts"))
    expect(res.status).toBe(200)

    const titles = Object.fromEntries(vi.mocked(createNotification).mock.calls.map(([input]) => [input.userId, input.title]))
    expect(titles).toEqual({
      "admin-ru": "Срок договора истекает: CTR-0042",
      "admin-plain": "Müqavilənin müddəti bitir: CTR-0042",
    })
  })
})

describe("the deploy's smoke call", () => {
  const routes = [
    ["/api/cron/renewal-alerts", renewalAlerts],
    ["/api/cron/contract-approval-escalations", approvalEscalations],
    ["/api/cron/contract-milestone-reminders", milestoneReminders],
    ["/api/cron/esign-reminders", esignReminders],
  ] as const

  it.each(routes)("%s answers without reading or sending anything", async (path, post) => {
    const res = await post(request(`${path}?smoke=1`))
    expect(await res.json()).toEqual({ success: true, data: { smoke: true } })
    expect(runWithRlsBypass).not.toHaveBeenCalled()
    expect(createNotification).not.toHaveBeenCalled()
  })

  it.each(routes)("%s refuses a stranger before it can see every tenant", async (path, post) => {
    const res = await post(request(path, "wrong-secret"))
    expect(res.status).toBe(401)
    expect(enterRlsBypass).not.toHaveBeenCalled()
    expect(runWithRlsBypass).not.toHaveBeenCalled()
  })
})
