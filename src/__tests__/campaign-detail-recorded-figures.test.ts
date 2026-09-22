// @vitest-environment jsdom
/**
 * The campaign page prints only figures the campaign's record holds.
 *
 * Until 2026-09-21 an SMS campaign read «Open Rate 0%», «Click Rate 0%» and
 * «Bounce rate 0%»: SMS, WhatsApp and Telegram record no opens or bounces on
 * the campaign — only email does (tracking pixel, link redirect, Resend
 * webhook) — so each of those zeros stood for «not measured». The green
 * «Sent» card showed sent minus Campaign.totalBounced, a column no code wrote.
 *
 * The page is rendered for real; only its data source and the heavy child
 * widgets are replaced.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "cmp-1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}))
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}))
// One object for the whole run: the page refetches whenever `session` changes identity.
const SESSION = { data: { user: { organizationId: "org-1" } } }
vi.mock("next-auth/react", () => ({ useSession: () => SESSION }))
vi.mock("next/dynamic", () => ({ default: () => () => null }))
vi.mock("@/components/campaign-form", () => ({ CampaignForm: () => null }))
vi.mock("@/components/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/ai/advisor-record-widget", () => ({ AdvisorRecordWidget: () => null }))
vi.mock("@/components/info-hint", () => ({
  InfoHint: ({ text }: { text: string }) => createElement("span", { "data-hint": text }),
}))
vi.mock("@/components/ui/tabs", () => {
  const pass = ({ children }: { children?: ReactNode }) => createElement("div", null, children)
  return { Tabs: pass, TabsList: pass, TabsTrigger: pass, TabsContent: pass }
})

import CampaignDetailPage from "@/app/(dashboard)/campaigns/[id]/page"

type Row = Record<string, unknown>

// The demo tenant's SMS campaign as GET /api/v1/campaigns/:id returns it
// (scripts/seeds/demo-journey-legend.mjs carries clicks and bounces for it,
// a real SMS campaign carries zeros).
const REAL_SMS: Row = {
  id: "cmp-1",
  name: "SMS: həftəsonu endirimi",
  type: "sms",
  status: "sent",
  totalRecipients: 2314,
  totalSent: 2291,
  totalOpened: 0,
  totalClicked: 0,
  totalBounced: 0,
  totalUnsubscribed: 0,
  totalSpam: 0,
  budget: 0,
  actualCost: 0,
  sentAt: "2026-09-12T08:00:00.000Z",
  createdAt: "2026-09-11T08:00:00.000Z",
}

const EMAIL: Row = {
  ...REAL_SMS,
  name: "Payız kolleksiyası",
  type: "email",
  totalSent: 1200,
  totalOpened: 300,
  totalClicked: 40,
  totalBounced: 12,
  totalUnsubscribed: 3,
}

let container: HTMLDivElement
let root: Root

async function renderPage(row: Row) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ success: true, data: row }), { status: 200 })),
  )
  await act(async () => {
    root.render(createElement(CampaignDetailPage))
  })
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

const text = (testId: string) => {
  const el = container.querySelector(`[data-testid="${testId}"]`)
  expect(el, testId).not.toBeNull()
  return el!.textContent ?? ""
}

/** The value printed on the stat card labelled `label`. */
const statCard = (label: string) => {
  const card = Array.from(container.querySelectorAll("div.rounded-xl")).find(
    (el) => el.querySelector("span.text-xs")?.textContent === label,
  )
  expect(card, label).toBeDefined()
  return card!.querySelector("span.text-2xl")?.textContent ?? ""
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("campaign page — figures the channel does not record", () => {
  it("prints «—», not 0%, for an SMS campaign's opens, clicks and bounces", async () => {
    await renderPage(REAL_SMS)
    expect(statCard("openRate")).toBe("—")
    expect(statCard("clickRate")).toBe("—")
    expect(statCard("opens")).toBe("—")
    expect(statCard("clicks")).toBe("—")
    for (const rate of ["open", "click", "bounce"]) {
      expect(text(`campaign-rate-${rate}`), rate).toContain("—")
      expect(text(`campaign-rate-${rate}`), rate).not.toContain("%")
    }
    expect(text("campaign-kpi-bounces")).toBe("—")
    expect(text("campaign-kpi-spam")).toBe("—")
    expect(text("campaign-kpi-unsubscribes")).toBe("—")
    expect(container.textContent).toContain("detailEngagementEmailOnly")
    expect(text("campaign-kpi-sent")).toBe((2291).toLocaleString())
  })

  it("shows the clicks an SMS record does carry, and still no open rate", async () => {
    await renderPage({ ...REAL_SMS, totalClicked: 96, totalBounced: 23 })
    expect(statCard("clicks")).toBe("96")
    expect(statCard("clickRate")).toBe("4%")
    expect(statCard("openRate")).toBe("—")
    expect(text("campaign-rate-bounce")).toContain("1%")
  })

  it("prints no rate at all before anything is sent", async () => {
    await renderPage({ ...EMAIL, status: "draft", totalSent: 0, totalOpened: 0, totalClicked: 0, totalBounced: 0, totalUnsubscribed: 0, sentAt: null })
    for (const rate of ["open", "click", "bounce"]) expect(text(`campaign-rate-${rate}`), rate).toContain("—")
    expect(text("campaign-kpi-bounces")).toBe("—")
    expect(container.textContent).not.toContain("detailEngagementEmailOnly")
  })
})

describe("campaign page — an email campaign's records", () => {
  it("shows what was sent, and bounces as their own figure", async () => {
    await renderPage(EMAIL)
    // Sent is what went out; bounces are not subtracted from it.
    expect(text("campaign-kpi-sent")).toBe((1200).toLocaleString())
    expect(text("campaign-kpi-bounces")).toBe("12")
    expect(text("campaign-kpi-unsubscribes")).toBe("3")
    expect(text("campaign-kpi-spam")).toBe("0")
    expect(statCard("openRate")).toBe("25%")
    expect(statCard("clickRate")).toBe("3%")
    expect(text("campaign-rate-bounce")).toContain("1%")
    expect(container.textContent).not.toContain("detailEngagementEmailOnly")
  })

  it("reads a sent email campaign with no bounces as a measured 0%", async () => {
    await renderPage({ ...EMAIL, totalBounced: 0 })
    expect(text("campaign-kpi-bounces")).toBe("0")
    expect(text("campaign-rate-bounce")).toContain("0%")
  })
})
