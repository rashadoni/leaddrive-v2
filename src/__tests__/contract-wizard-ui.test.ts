// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }))
vi.mock("next-intl", () => ({
  useLocale: () => "az",
  useTranslations: () => {
    const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}${JSON.stringify(values)}` : key)
    translate.has = () => true
    return translate
  },
}))

import { ContractWizard } from "@/components/contracts/contract-wizard"
import { CompanyForm } from "@/components/company-form"
import { readHint } from "./helpers/hint"

/**
 * «Yeni müqavilə» as the owner's mock has it (2026-11-25): template → parties
 * by VÖEN → terms → check. On real React in jsdom with the server stood in by
 * `fetch`: what the person sees at each step and what is sent. Keys stand in
 * for the translated words.
 */
let container: HTMLDivElement
let root: Root
const sent: Array<{ url: string; body: Record<string, unknown> | null }> = []

const context = {
  our: { name: "«Nümunə» MMC", voen: "1402578361", address: "Bakı", director: "Rəşad Rəhimov" },
  ourBanks: [{ id: "settings", label: "Kapital Bank · AZ21…1944" }],
  templates: [{ id: "tpl-1", name: "Alğı-satqı müqaviləsi", description: null, clauseCount: 10, ownFieldCount: 3 }],
  deal: { id: "deal-1", name: "Kaspi — 400 palet", valueAmount: 48000, currency: "AZN", company: null },
}

function previewFor(body: Record<string, unknown>) {
  const typed = (body.typed ?? {}) as Record<string, string>
  const missing = typed.predmet ? [] : ["predmet"]
  return {
    renderedBody: `ALĞI-SATQI\n«Kaspi Logistika» MMC alır: ${typed.predmet ?? "________"}.\n\nTƏRƏFLƏRİN REKVİZİTLƏRİ`,
    missing,
    asked: [{ name: "predmet", type: "string", required: true, label: "Müqavilənin predmeti" }],
    standard: ["counterparty_name", "contract_amount", "contract_currency"],
    company: { action: "update", id: "co-kaspi", name: "Kaspi", fields: ["director", "bankAccount"] },
  }
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  sent.length = 0
  push.mockReset()
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
      sent.push({ url, body })
      const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data }) as Response
      if (url.startsWith("/api/v1/contracts/wizard") && !init) return json({ success: true, data: context })
      if (url === "/api/v1/companies/registry-lookup") {
        return json({
          success: true,
          data: {
            card: { name: "«Kaspi Logistika» MMC", legalForm: "MMC", legalAddress: "Bakı, Xətai r.", director: "Fərid Qəhrəmanov", active: true, vatPayer: true },
            duplicate: { id: "co-kaspi", name: "Kaspi" },
          },
        })
      }
      if (url === "/api/v1/companies/co-kaspi") {
        return json({ success: true, data: { id: "co-kaspi", name: "Kaspi", address: null, director: null, bankName: "ABB", bankAccount: "AZ77IBAZ3801", bankCode: null, bankSwift: null, bankVoen: null, bankCorrAccount: null } })
      }
      if (url === "/api/v1/contracts/wizard" && body?.preview) return json({ success: true, data: previewFor(body) })
      if (url === "/api/v1/contracts/wizard") return json({ success: true, data: { contract: { id: "ctr-1" }, company: { id: "co-kaspi" } } }, 201)
      return json({ error: "unexpected " + url }, 500)
    }),
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) })
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!
const click = async (el: Element) => { await act(async () => (el as HTMLElement).click()); await flush() }
async function type(id: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)!
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function toStepFour() {
  await act(async () => root.render(createElement(ContractWizard, { dealId: "deal-1" })))
  await flush()
  await click(container.querySelector('[data-testid="wizard-template-tpl-1"]')!)
  await click(button("next"))
  await type("wizard-voen", "1307137771")
  await click(container.querySelector('[data-testid="wizard-lookup"]')!)
  await click(button("next"))
  await type("wizard-var-predmet", "Taxta palet")
  await click(button("check"))
}

describe("the contract wizard", () => {
  it("starts from the deal and shows the library's templates with how many fields a person fills", async () => {
    await act(async () => root.render(createElement(ContractWizard, { dealId: "deal-1" })))
    await flush()
    expect(sent[0].url).toBe("/api/v1/contracts/wizard?deal=deal-1")
    const card = container.querySelector('[data-testid="wizard-template-tpl-1"]')!
    expect(card.textContent).toContain('templateMeta{"clauses":10,"fields":3}')
    expect(container.querySelector('[data-testid="wizard-template-blank"]')).not.toBeNull()
    expect(container.textContent).toContain("Kaspi — 400 palet")
  })

  it("by VÖEN fills the counterparty from the registry and its bank from the card the CRM already has", async () => {
    await act(async () => root.render(createElement(ContractWizard, { dealId: "deal-1" })))
    await flush()
    await click(button("next"))
    await type("wizard-voen", "1307137771")
    const lookup = container.querySelector('[data-testid="wizard-lookup"]')!
    expect(await readHint(lookup.closest("span") ?? lookup)).toBe("lookupHint")
    await click(lookup)

    expect(sent.find((s) => s.url === "/api/v1/companies/registry-lookup")?.body).toEqual({ voen: "1307137771" })
    // the contract names the company as the registry does; the card «Kaspi» is not renamed (server: companyChanges)
    expect(container.querySelector<HTMLInputElement>("#wizard-name")!.value).toBe("«Kaspi Logistika» MMC")
    expect(container.querySelector<HTMLInputElement>("#wizard-address")!.value).toBe("Bakı, Xətai r.")
    expect(container.querySelector<HTMLInputElement>("#wizard-director")!.value).toBe("Fərid Qəhrəmanov")
    expect(container.querySelector<HTMLInputElement>("#wizard-bankAccount")!.value).toBe("AZ77IBAZ3801")
    expect(container.querySelector('[data-testid="wizard-registry-card"]')?.textContent).toContain("vatPayer")
    expect(container.querySelector('[data-testid="wizard-company-known"]')).not.toBeNull()
  })

  it("asks on step 3 only for the template's own field, by its label, and says it is still empty", async () => {
    await act(async () => root.render(createElement(ContractWizard, { dealId: "deal-1" })))
    await flush()
    await click(button("next"))
    await type("wizard-name", "«Kaspi Logistika» MMC")
    await click(button("next"))
    const terms = container.querySelector('[data-testid="wizard-step-terms"]')!
    expect(terms.querySelectorAll("input")).toHaveLength(1)
    expect(terms.textContent).toContain("Müqavilənin predmeti")
    expect(container.querySelector('[data-testid="wizard-missing"]')?.textContent).toContain("Müqavilənin predmeti")
    expect(container.querySelector('[data-testid="wizard-filled-count"]')?.textContent).toBe('filledCount{"filled":3,"total":4}')
  })

  it("step 4 shows the document and what the company card gains, then saves a draft", async () => {
    await toStepFour()
    expect(container.querySelector('[data-testid="wizard-document"]')?.textContent).toContain("alır: Taxta palet.")
    expect(container.querySelector('[data-testid="wizard-company-plan"]')?.textContent).toContain("planUpdate")

    const save = container.querySelector('[data-testid="wizard-save-draft"]')!
    expect(await readHint(save.closest("span") ?? save)).toBe("saveDraftHint")
    await click(save)
    const create = sent.find((s) => s.url === "/api/v1/contracts/wizard" && s.body?.preview === false)!
    expect(create.body).toMatchObject({
      templateId: "tpl-1",
      dealId: "deal-1",
      companyId: "co-kaspi",
      counterparty: { voen: "1307137771", name: "«Kaspi Logistika» MMC", bank: { bankAccount: "AZ77IBAZ3801", bankName: "ABB" }, saveBank: true },
      ourBank: "settings",
      typed: { predmet: "Taxta palet" },
      lang: "az",
    })
    expect(push).toHaveBeenCalledWith("/contracts/ctr-1")
  })

  it("«send for approval» opens the contract with its approval window", async () => {
    await toStepFour()
    await click(container.querySelector('[data-testid="wizard-send-approval"]')!)
    expect(push).toHaveBeenCalledWith("/contracts/ctr-1?approve=1")
  })
})

describe("the company form", () => {
  it("edits and sends the bank requisites with the rest of the card", async () => {
    await act(async () =>
      root.render(
        createElement(CompanyForm, {
          open: true,
          onOpenChange: () => {},
          onSaved: () => {},
          initialData: { id: "co-kaspi", name: "Kaspi", bankName: "ABB", bankAccount: "AZ77IBAZ3801" } as never,
        }),
      ),
    )
    await flush()
    const fieldset = document.querySelector('[data-testid="company-bank-requisites"]')!
    expect(fieldset.querySelectorAll("input")).toHaveLength(6)
    expect(document.querySelector<HTMLInputElement>("#bankAccount")!.value).toBe("AZ77IBAZ3801")
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
    const swift = document.querySelector<HTMLInputElement>("#bankSwift")!
    await act(async () => {
      setter.call(swift, "IBAZAZ2X")
      swift.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const form = document.querySelector("form")!
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    await flush()
    const put = sent.find((s) => s.url === "/api/v1/companies/co-kaspi")!
    expect(put.body).toMatchObject({ bankName: "ABB", bankAccount: "AZ77IBAZ3801", bankSwift: "IBAZAZ2X", bankCode: "" })
  })
})
