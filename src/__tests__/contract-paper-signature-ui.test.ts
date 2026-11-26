// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: () => {
    const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}${JSON.stringify(values)}` : key)
    translate.has = (key: string) => key.startsWith("paperSignErrors.") && !key.endsWith("UNKNOWN_CODE")
    return translate
  },
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ContractPaperSignatureButton, ContractPaperSignatureRow } from "@/components/contracts/contract-paper-signature"
import { readHint } from "./helpers/hint"

/**
 * «Подписан на бумаге» on the contract card (owner 2026-11-26): who sees the
 * button, what the window says will follow, and what goes to the server.
 * React in jsdom; the server is `fetch`.
 */
let container: HTMLDivElement
let root: Root
const sent: Array<{ url: string; method: string; body: FormData | null }> = []
let reply: { status: number; json: unknown } = { status: 200, json: { success: true } }

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-26T10:00:00Z"))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  sent.length = 0
  reply = { status: 200, json: { success: true } }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, method: init?.method ?? "GET", body: init?.body instanceof FormData ? init.body : null })
      return { ok: reply.status < 400, status: reply.status, json: async () => reply.json } as Response
    }),
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const click = async (el: Element | null) => { await act(async () => (el as HTMLElement).click()); await flush() }

async function render(status: string, role: string, endDate: string | null = "2027-12-31T00:00:00.000Z") {
  const onSigned = vi.fn()
  await act(async () => root.render(createElement(ContractPaperSignatureButton, { contractId: "ctr-1", status, role, endDate, onSigned })))
  return onSigned
}

function choose(file: File) {
  const input = container.querySelector("#paper-signed-copy") as HTMLInputElement
  Object.defineProperty(input, "files", { value: [file], configurable: true })
  return act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })) })
}
async function submit() {
  await act(async () => { (q("paper-sign-form") as HTMLFormElement).requestSubmit() })
  await flush()
}

describe("who sees «Подписан на бумаге»", () => {
  it("anyone who edits contracts, on an approved contract", async () => {
    await render("approved", "manager")
    expect(q("paper-sign-open")?.textContent).toContain("paperSignButton")
    expect(await readHint(q("paper-sign-open")!)).toBe("paperSignHint")
  })

  it("on a draft only an administrator — it skips approval — and the hint says so", async () => {
    await render("draft", "manager")
    expect(q("paper-sign-open")).toBeNull()
    await render("draft", "admin")
    expect(await readHint(q("paper-sign-open")!)).toBe("paperSignHintDraft")
    await click(q("paper-sign-open"))
    expect(container.textContent).toContain("paperSignDraftNote")
  })

  it("nobody, on a contract already in force, sent for approval or closed", async () => {
    for (const status of ["active", "pending_approval", "rejected", "expired", "cancelled"]) {
      await render(status, "admin")
      expect(q("paper-sign-open")).toBeNull()
    }
  })
})

describe("the window", () => {
  it("says what follows: «Активный», the reminders before the end date and the day it runs out", async () => {
    await render("approved", "manager")
    await click(q("paper-sign-open"))
    expect(q("paper-sign-consequence")?.textContent).toBe('paperSignWillRemind{"end":"31.12.2027","expire":"01.01.2028"}')
    expect((container.querySelector("#paper-signed-at") as HTMLInputElement).value).toBe("2026-11-26")
    expect((container.querySelector("#paper-signed-at") as HTMLInputElement).max).toBe("2026-11-26")
  })

  it("says when there will be no reminders, and when the end date has already passed", async () => {
    await render("approved", "manager", null)
    await click(q("paper-sign-open"))
    expect(q("paper-sign-consequence")?.textContent).toBe("paperSignNoEndDate")
    await render("approved", "manager", "2026-10-31T00:00:00.000Z")
    expect(q("paper-sign-consequence")?.textContent).toBe('paperSignAlreadyEnded{"end":"31.10.2026"}')
  })

  it("sends nothing without the scan", async () => {
    await render("approved", "manager")
    await click(q("paper-sign-open"))
    await submit()
    expect(sent).toEqual([])
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("paperSignErrors.FILE_REQUIRED")
  })

  it("sends the day and the scan, closes and tells the card", async () => {
    const onSigned = await render("approved", "manager")
    await click(q("paper-sign-open"))
    const scan = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "dogovor.pdf", { type: "application/pdf" })
    await choose(scan)
    expect(container.textContent).toContain("dogovor.pdf")
    await submit()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ url: "/api/v1/contracts/ctr-1/paper-signature", method: "POST" })
    expect(sent[0].body?.get("signedAt")).toBe("2026-11-26")
    expect((sent[0].body?.get("file") as File).name).toBe("dogovor.pdf")
    expect(onSigned).toHaveBeenCalledTimes(1)
    expect(q("paper-sign-form")).toBeNull()
  })

  it("a refusal is said in words and the window stays", async () => {
    reply = { status: 403, json: { code: "ADMIN_REQUIRED_FOR_DRAFT" } }
    const onSigned = await render("approved", "manager")
    await click(q("paper-sign-open"))
    await choose(new File(["%PDF-"], "a.pdf", { type: "application/pdf" }))
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("paperSignErrors.ADMIN_REQUIRED_FOR_DRAFT")
    expect(q("paper-sign-form")).not.toBeNull()
    expect(onSigned).not.toHaveBeenCalled()

    reply = { status: 500, json: { code: "UNKNOWN_CODE" } }
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("paperSignErrors.FAILED")
  })
})

describe("after it", () => {
  it("the card names who recorded it, the day, and opens the scan", async () => {
    await act(async () => root.render(createElement(ContractPaperSignatureRow, {
      info: { signedAt: "2026-11-20T00:00:00.000Z", recordedBy: "Rashad", file: { id: "f1", fileName: "abc.pdf", originalName: "dogovor.pdf", mimeType: "application/pdf" } },
    })))
    expect(q("paper-sign-row")?.textContent).toContain('paperSignedLine{"date":"20.11.2026","name":"Rashad"}')
    expect((container.querySelector('a[href="/uploads/contracts/abc.pdf"]') as HTMLAnchorElement).textContent).toBe("paperSignOpenScan")
  })
})
