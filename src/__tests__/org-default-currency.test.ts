// @vitest-environment jsdom
/**
 * New records start in the organisation's own currency, not in whatever the
 * browser build happened to inline.
 *
 * `DEFAULT_CURRENCY` is `process.env.NEXT_PUBLIC_DEFAULT_CURRENCY || "USD"`.
 * Next.js inlines NEXT_PUBLIC_* at build time and the deploy build never set
 * it, so the live chunks (2026-09-22) read `…env.NEXT_PUBLIC_DEFAULT_CURRENCY
 * ||"USD"` — "USD" in every browser — while the server's PM2 env said "AZN".
 * A new invoice started in dollars even in the one organisation (the owner's
 * own) that had set «Default currency: AZN» in Invoice settings.
 *
 * This file runs with NEXT_PUBLIC_DEFAULT_CURRENCY unset, exactly like the
 * browser: the old forms show USD here, the new ones the organisation's AZN.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findUnique: vi.fn() }, currency: { findFirst: vi.fn() } },
}))
vi.mock("@/lib/api-auth", () => ({ getOrgId: vi.fn(), getSession: vi.fn() }))
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}))
// Stable objects: components re-run effects when these change identity.
const session = { data: { user: { organizationId: "org-1" } }, status: "authenticated" }
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }
const searchParams = new URLSearchParams()
vi.mock("next-auth/react", () => ({ useSession: () => session }))
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => searchParams }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))

import { resolveOrgDefaultCurrency } from "@/lib/org-default-currency"
import { GET as DEFAULT_CURRENCY_ROUTE } from "@/app/api/v1/organization/default-currency/route"
import { resetOrgDefaultCurrencyCache, useCurrencyField } from "@/lib/use-org-default-currency"
import CreateInvoicePage from "@/app/(dashboard)/invoices/create/page"
import { DealForm } from "@/components/deal-form"
import { DEFAULT_CURRENCY } from "@/lib/currency"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession } from "@/lib/api-auth"

/** An organisation as the database holds it. */
function organisation(invoiceDefault: string | null, base: string | null) {
  vi.mocked(prisma.organization.findUnique).mockResolvedValue(
    { settings: invoiceDefault ? { invoice: { defaultCurrency: invoiceDefault } } : {} } as never,
  )
  vi.mocked(prisma.currency.findFirst).mockResolvedValue((base ? { code: base } : null) as never)
}

beforeEach(() => {
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(getSession).mockResolvedValue(null as never)
})

describe("the organisation's default currency", () => {
  it("is the one chosen in Invoice settings, then the base currency, then the deployment's default", async () => {
    organisation("AZN", "USD")
    expect(await resolveOrgDefaultCurrency("org-1")).toBe("AZN")
    organisation(null, "EUR")
    expect(await resolveOrgDefaultCurrency("org-1")).toBe("EUR")
    organisation("manat", "AZN") // not a currency code: ignored
    expect(await resolveOrgDefaultCurrency("org-1")).toBe("AZN")
    organisation(null, null)
    expect(await resolveOrgDefaultCurrency("org-1")).toBe(DEFAULT_CURRENCY)
  })

  it("is served to any signed-in member by GET /api/v1/organization/default-currency", async () => {
    organisation("AZN", "USD")
    const res = await DEFAULT_CURRENCY_ROUTE(new Request("http://localhost/api/v1/organization/default-currency") as never)
    expect(await res.json()).toEqual({ success: true, data: { defaultCurrency: "AZN" } })
  })
})

// ── Forms, as rendered ──────────────────────────────────────────────

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  resetOrgDefaultCurrencyCache()
  // The owner's organisation on prod: «Default currency: AZN» in Invoice settings.
  organisation("AZN", "AZN")
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost")
      if (url.pathname === "/api/v1/organization/default-currency") return DEFAULT_CURRENCY_ROUTE(new Request(url) as never)
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

/** The value of the currency <select>: the one whose options are currency codes. */
function currencySelect(): HTMLSelectElement {
  const select = Array.from(container.querySelectorAll("select")).find((s) =>
    Array.from(s.options).some((o) => o.value === "AZN") && Array.from(s.options).some((o) => o.value === "USD"),
  )
  expect(select, "currency select").toBeTruthy()
  return select as HTMLSelectElement
}

describe("a new invoice", () => {
  it("starts in the organisation's AZN, not the browser's USD", async () => {
    expect(DEFAULT_CURRENCY).toBe("USD") // the browser's view: the variable is not inlined
    await act(async () => {
      root.render(createElement(CreateInvoicePage))
    })
    await settle()
    expect(currencySelect().value).toBe("AZN")
  })
})

describe("a new deal", () => {
  it("starts in the organisation's currency; an existing deal keeps its own", async () => {
    await act(async () => {
      root.render(createElement(DealForm, { open: true, onOpenChange: () => {}, onSaved: () => {}, orgId: "org-1" }))
    })
    await settle()
    expect(currencySelect().value).toBe("AZN")

    await act(async () => {
      root.render(createElement(DealForm, { open: true, onOpenChange: () => {}, onSaved: () => {}, orgId: "org-1", initialData: { id: "d1", name: "Ofis", currency: "EUR" } }))
    })
    await settle()
    expect(currencySelect().value).toBe("EUR")
  })
})

describe("the currency field", () => {
  function Probe({ onReady }: { onReady: (api: ReturnType<typeof useCurrencyField>) => void }) {
    const api = useCurrencyField()
    onReady(api)
    return createElement("span", { "data-testid": "currency" }, api.currency)
  }
  const shown = () => container.querySelector('[data-testid="currency"]')?.textContent

  it("never overwrites a currency someone already chose — a picked deal's, say", async () => {
    let api: ReturnType<typeof useCurrencyField> | null = null
    await act(async () => {
      root.render(createElement(Probe, { onReady: (a) => { api = a } }))
    })
    // Chosen before the organisation's currency arrives.
    await act(async () => {
      api!.setCurrency("GBP")
    })
    await settle()
    expect(shown()).toBe("GBP")
    // Starting a new record takes the organisation's currency again.
    await act(async () => {
      api!.resetCurrency()
    })
    expect(shown()).toBe("AZN")
  })
})
