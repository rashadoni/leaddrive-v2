// @vitest-environment jsdom
/**
 * No lead screen prints a conversion probability that no model estimated.
 *
 * The leads list, the lead page, the lead modal, the list's conversion sort,
 * GET /api/v1/lead-scoring and the two scoring pages all filled a missing
 * `scoreDetails.conversionProb` with `Math.round(score × 0.85)`. On prod on
 * 2026-09-21 none of the 106 open leads carried a stored probability — the
 * scorer the cron and every lead edit run (src/lib/ai/lead-scoring.ts) writes
 * `{ factors }` only — so every one of those percentages was the score × 0.85.
 *
 * A lead scored 90 with no estimate used to read «77%». The checks below render
 * the real screens, fed by the real scoring route over mocked rows.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: { lead: { findMany: vi.fn() } } }))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn() }))
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}${JSON.stringify(values)}` : key,
  useLocale: () => "en",
}))
// Stable objects: pages re-fetch whenever `session` changes identity.
const session = { data: { user: { organizationId: "org-1", role: "admin", id: "u1" } }, status: "authenticated" }
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }
const searchParams = new URLSearchParams()
vi.mock("next-auth/react", () => ({ useSession: () => session }))
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => searchParams, usePathname: () => "/leads" }))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => undefined, useTour: () => ({}) }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/did-you-know", () => ({ DidYouKnow: () => null }))
// The leads page's own dialogs, pickers and call widgets: not what is under test.
vi.mock("@/components/lead-form", () => ({ LeadForm: () => null }))
vi.mock("@/components/lead-convert-dialog", () => ({ LeadConvertDialog: () => null }))
vi.mock("@/components/sequences/enroll-in-sequence-dialog", () => ({ EnrollInSequenceDialog: () => null }))
vi.mock("@/components/leads/late-callbacks-panel", () => ({ LateCallbacksPanel: () => null }))
vi.mock("@/components/leads/lead-browser-call-action", () => ({ LeadBrowserCallAction: () => null }))
vi.mock("@/components/saved-view-bar", () => ({ SavedViewBar: () => null }))
vi.mock("@/components/voice-call-queues/voice-call-queue-preview", () => ({ VoiceCallQueuePreview: () => null }))
vi.mock("@/components/user-picker", () => ({ UserPicker: () => null }))
vi.mock("@/components/entity-bulk-bar", () => ({ EntityBulkBar: () => null }))

import { compareLeads, type SortableLead } from "@/lib/leads/sort"
import { averageProbability, compareProbabilities } from "@/lib/leads/conversion-probability"
import { GET as SCORES } from "@/app/api/v1/lead-scoring/route"
import AILeadScoringPage from "@/app/(dashboard)/ai-scoring/page"
import LeadScoringPage from "@/app/(dashboard)/lead-scoring/page"
import LeadsPage from "@/app/(dashboard)/leads/page"
import { LeadItemModal } from "@/components/lead-item-modal"
import { TooltipProvider } from "@/components/ui/tooltip"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession } from "@/lib/api-auth"

/** What the scorer the cron and every lead edit run leaves behind: factors, no probability. */
const HEURISTIC = { factors: { contactCompleteness: 64, engagementLevel: 40, dealPotential: 24, sourceQuality: 0, recency: 67 } }

/** Three leads as the database holds them. */
function rows() {
  const base = {
    organizationId: "org-1", email: null, phone: null, companyName: "Demo Mebel", source: "website",
    status: "qualified", priority: "high", estimatedValue: null, notes: null, lastScoredAt: new Date("2026-09-21T08:00:00Z"),
    createdAt: new Date("2026-09-20T08:00:00Z"), category: "vip", assignedTo: null,
  }
  return [
    // Score 90, never estimated: the old screens printed 77%.
    { ...base, id: "a", contactName: "Leyla Məmmədova", score: 90, scoreDetails: HEURISTIC },
    // Da Vinci's own estimate.
    { ...base, id: "b", contactName: "Nigar Əliyeva", score: 70, scoreDetails: { conversionProb: 64, aiPowered: true, factors: {} } },
    // An old rule-based run stored round(50 × 0.85) = 43 as if it were a probability.
    { ...base, id: "c", contactName: "Cavid Məlikov", score: 50, scoreDetails: { conversionProb: 43, aiPowered: false, factors: {} } },
  ]
}

/** The same leads as GET /api/v1/leads returns them. */
function apiLeads() {
  return rows().map((r) => ({ ...r, lastScoredAt: r.lastScoredAt.toISOString(), createdAt: r.createdAt.toISOString() }))
}

describe("conversion probability, where no model estimated one", () => {
  const sortable = (id: string, score: number, scoreDetails: unknown, createdAt = "2026-09-20T08:00:00.000Z"): SortableLead =>
    ({ id, score, scoreDetails, createdAt, contactName: id, companyName: null, source: null, status: "new" })

  it("sorts a lead with no estimate after every lead with one, both ways", () => {
    const estimated64 = sortable("64", 70, { conversionProb: 64, aiPowered: true })
    const estimated20 = sortable("20", 30, { conversionProb: 20, aiPowered: true })
    const unestimated90 = sortable("x90", 90, HEURISTIC)
    const leads = [unestimated90, estimated20, estimated64]
    expect([...leads].sort((a, b) => compareLeads(a, b, "conversion_desc")).map((l) => l.id)).toEqual(["64", "20", "x90"])
    expect([...leads].sort((a, b) => compareLeads(a, b, "conversion_asc")).map((l) => l.id)).toEqual(["20", "64", "x90"])
  })

  it("averages only what was estimated", () => {
    expect(averageProbability([null, 64, null])).toEqual({ value: 64, count: 1 })
    expect(averageProbability([null, null])).toBeNull()
    expect([null, 10, 90].sort((a, b) => compareProbabilities(a, b, "desc"))).toEqual([90, 10, null])
  })

  it("GET /api/v1/lead-scoring returns the model's estimate or null — never the score × 0.85", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(getSession).mockResolvedValue(null as never)
    vi.mocked(prisma.lead.findMany).mockResolvedValue(rows() as never)
    const json = await (await SCORES(new Request("http://localhost/api/v1/lead-scoring") as never)).json()
    expect(json.data.leads.map((l: { id: string; conversionProb: number | null }) => [l.id, l.conversionProb])).toEqual([
      ["a", null],
      ["b", 64],
      ["c", null],
    ])
  })
})

// ── The screens, as rendered ────────────────────────────────────────

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(getSession).mockResolvedValue(null as never)
  vi.mocked(prisma.lead.findMany).mockResolvedValue(rows() as never)
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost")
      // The scoring pages read the real route.
      if (url.pathname === "/api/v1/lead-scoring" && (!init?.method || init.method === "GET")) {
        return SCORES(new Request(url) as never)
      }
      if (url.pathname === "/api/v1/leads") {
        return new Response(JSON.stringify({ success: true, data: { leads: apiLeads(), total: 3 } }))
      }
      return new Response(JSON.stringify({ success: true, data: [] }))
    }),
  )
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** The dashboard layout mounts a TooltipProvider around every page. */
async function render(element: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(createElement(TooltipProvider, null, element))
  })
  await settle()
}

const text = () => container.textContent ?? ""
// 90 × 0.85 → 77; the stored rule-based 43; the old average (77 + 64 + 43) / 3 → 61.
const INVENTED = /(?<!\d)(77|43|61)%/

describe("AI scoring page", () => {
  it("shows «—» for leads Da Vinci did not estimate and averages only the one it did", async () => {
    await render(createElement(AILeadScoringPage))
    expect(text()).not.toMatch(INVENTED)
    const summary = container.querySelector('[data-testid="ai-scoring-probability"]')?.textContent ?? ""
    expect(summary).toContain("64%")
    expect(summary).toContain('convProbBasis{"count":1,"total":3}')
    expect(text()).toContain("convProbLifetime")
  })
})

describe("Lead scoring page", () => {
  it("averages only estimated leads and prints «—» for the rest", async () => {
    await render(createElement(LeadScoringPage))
    expect(text()).not.toMatch(INVENTED)
    expect(container.querySelector('[data-testid="lead-scoring-probability"]')?.textContent).toContain("64")
    expect(text()).toContain('convProbBasis{"count":1,"total":3}')
  })
})

describe("Lead modal", () => {
  it("shows «—» with the reason for a lead scored 90 that no model estimated", async () => {
    const lead = { ...apiLeads()[0] }
    await render(createElement(LeadItemModal, { open: true, onOpenChange: () => {}, lead, orgId: "org-1" }))
    expect(text()).not.toMatch(INVENTED)
    const aiTab = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "modalAiScoring")
    expect(aiTab, "Da Vinci tab").toBeTruthy()
    await act(async () => {
      aiTab!.click()
    })
    expect(text()).not.toMatch(INVENTED)
    expect(text()).toContain("convProbNoneShort")
    expect(text()).toContain("convProbNone")
  })
})

describe("Leads list", () => {
  it("prints «—» in the Conversion column and sorts unestimated leads last", async () => {
    await render(createElement(LeadsPage))
    const table = Array.from(container.querySelectorAll("button")).find((b) => b.getAttribute("title") === "list")
    expect(table, "table view toggle").toBeTruthy()
    await act(async () => {
      table!.click()
    })
    await settle()
    expect(text()).not.toMatch(INVENTED)
    const cells = Array.from(container.querySelectorAll("td span[title='convProbNone']")).map((c) => c.textContent)
    // Two leads without an estimate, in the table and in the stacked mobile cards.
    expect(cells.length).toBeGreaterThanOrEqual(2)
    expect(new Set(cells)).toEqual(new Set(["—"]))
    expect(text()).toContain("64%")
  })
})
