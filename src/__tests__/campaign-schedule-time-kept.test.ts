// @vitest-environment jsdom
/**
 * Opening and saving a scheduled campaign keeps the minute it goes out.
 *
 * Until 2026-10-17 it did not: the campaign page handed the edit form the date
 * alone, and the form filled its datetime-local input with the UTC clock and
 * saved it as local time. In Baku a campaign planned for 15:00 came back from
 * an edit at 00:00 (from the campaign page) or 11:00 (from the list), and the
 * scheduler sends whatever is due — to customers, hours early.
 *
 * The page is rendered for real; the edit form is replaced by a probe that
 * keeps what the page hands it, and that value goes through the form's own
 * conversion and back the way the form submits it.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { scheduledAtInputValue } from "@/lib/campaigns/schedule-input"

const handedToForm: Array<{ scheduledAt?: string }> = []

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "cmp-1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}))
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}))
const SESSION = { data: { user: { organizationId: "org-1" } } }
vi.mock("next-auth/react", () => ({ useSession: () => SESSION }))
vi.mock("next/dynamic", () => ({ default: () => () => null }))
vi.mock("@/components/campaign-form", () => ({
  CampaignForm: ({ initialData }: { initialData?: { scheduledAt?: string } }) => {
    if (initialData) handedToForm.push(initialData)
    return null
  },
}))
vi.mock("@/components/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/ai/advisor-record-widget", () => ({ AdvisorRecordWidget: () => null }))
vi.mock("@/components/info-hint", () => ({ InfoHint: () => null }))
vi.mock("@/components/ui/tabs", () => {
  const pass = ({ children }: { children?: ReactNode }) => createElement("div", null, children)
  return { Tabs: pass, TabsList: pass, TabsTrigger: pass, TabsContent: pass }
})

import CampaignDetailPage from "@/app/(dashboard)/campaigns/[id]/page"

/** What the form submits for its input (campaign-form.tsx: `new Date(form.scheduledAt).toISOString()`). */
const submitted = (inputValue: string) => new Date(inputValue).toISOString()

const originalTz = process.env.TZ
beforeAll(() => {
  // The owner's customers are in Baku, UTC+4 — where the shift was four hours.
  process.env.TZ = "Asia/Baku"
})
afterAll(() => {
  process.env.TZ = originalTz
})

describe("the form's input keeps the instant", () => {
  it.each([
    ["afternoon", "2026-10-20T11:00:00.000Z", "2026-10-20T15:00"],
    ["just after local midnight, the previous day in UTC", "2026-10-19T20:30:00.000Z", "2026-10-20T00:30"],
    ["late evening", "2026-10-20T19:45:00.000Z", "2026-10-20T23:45"],
  ])("%s", (_case, stored, input) => {
    expect(scheduledAtInputValue(stored)).toBe(input)
    expect(submitted(scheduledAtInputValue(stored))).toBe(stored)
  })

  it("leaves an unscheduled campaign empty", () => {
    expect(scheduledAtInputValue(null)).toBe("")
    expect(scheduledAtInputValue("")).toBe("")
    expect(scheduledAtInputValue("not a date")).toBe("")
  })
})

describe("the campaign page hands the form the whole instant", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    handedToForm.length = 0
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  it("so an edit sends the campaign at 15:00 Baku, not at midnight", async () => {
    const scheduledAt = "2026-10-20T11:00:00.000Z"
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({
        success: true,
        data: { id: "cmp-1", name: "Telegram: vebinar", type: "telegram", status: "scheduled", totalRecipients: 860, totalSent: 0, budget: 150, scheduledAt, createdAt: "2026-10-17T08:00:00.000Z" },
      }), { status: 200 })),
    )
    await act(async () => {
      root.render(createElement(CampaignDetailPage))
    })
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
    }
    const handed = handedToForm.at(-1)?.scheduledAt ?? ""
    expect(submitted(scheduledAtInputValue(handed))).toBe(scheduledAt)
  })
})
