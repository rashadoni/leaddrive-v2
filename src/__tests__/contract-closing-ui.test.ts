// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: () => {
    const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}${JSON.stringify(values)}` : key)
    translate.has = (key: string) => !key.endsWith("UNKNOWN_CODE")
    return translate
  },
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import {
  ContractCancelDialog,
  ContractClosingBanner,
  ContractReopenButton,
  ContractTerminateDialog,
  canCancel,
  canTerminate,
} from "@/components/contracts/contract-closing"
import { readHint } from "./helpers/hint"

/**
 * Ending a contract on its card (owner 2026-11-26, mock «Расторжение»): what
 * each window says will follow, what goes to the server, the line under the
 * header and «Вернуть в черновик». React in jsdom; the server is `fetch`.
 */
let container: HTMLDivElement
let root: Root
const sent: Array<{ url: string; method: string; body: unknown }> = []
let reply: { status: number; json: unknown } = { status: 200, json: { success: true, data: {} } }

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-11-26T10:00:00Z"))
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  sent.length = 0
  reply = { status: 200, json: { success: true, data: {} } }
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : null
    sent.push({ url, method: init?.method ?? "GET", body })
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.json } as Response
  }))
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const field = (id: string) => container.querySelector(`#${id}`) as HTMLInputElement
async function type(id: string, value: string) {
  const input = field(id)
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })) })
}
async function submit(form: string) {
  await act(async () => { (q(form) as HTMLFormElement).requestSubmit() })
  await flush()
}

describe("which contract offers what", () => {
  it("termination only in force and not yet set; cancellation only before it took effect", () => {
    expect(canTerminate({ status: "active", terminationDate: null })).toBe(true)
    expect(canTerminate({ status: "renewing", terminationDate: null })).toBe(true)
    expect(canTerminate({ status: "active", terminationDate: "2026-12-01" })).toBe(false)
    for (const status of ["draft", "approved", "terminated", "expired"]) expect(canTerminate({ status, terminationDate: null })).toBe(false)
    for (const status of ["draft", "pending_approval", "approved"]) expect(canCancel({ status })).toBe(true)
    for (const status of ["active", "rejected", "terminated", "cancelled"]) expect(canCancel({ status })).toBe(false)
  })
})

describe("«Расторгнуть договор»", () => {
  async function open(endDate: string | null = "2027-12-31T00:00:00.000Z") {
    const onDone = vi.fn()
    await act(async () => root.render(createElement(ContractTerminateDialog, { open: true, onOpenChange: vi.fn(), contractId: "ctr-1", endDate, onDone })))
    return onDone
  }

  it("today: says it ends at once and cannot be undone; the latest day is the one after the end date", async () => {
    await open()
    expect(field("termination-date").value).toBe("2026-11-26")
    expect(field("termination-date").max).toBe("2028-01-01")
    expect(q("terminate-consequence")?.textContent).toBe("closing.immediateNote")
  })

  it("a later day: says it stays in force until then and can be withdrawn", async () => {
    await open()
    await type("termination-date", "2026-12-01")
    expect(q("terminate-consequence")?.textContent).toBe('closing.scheduledNote{"date":"01.12.2026"}')
  })

  it("sends the day, the reason, the comment and the agreement, then tells the card", async () => {
    reply = { status: 200, json: { success: true, data: { scheduled: true } } }
    const onDone = await open()
    await type("termination-date", "2026-12-01")
    const select = field("termination-reason") as unknown as HTMLSelectElement
    await act(async () => { select.value = "breach"; select.dispatchEvent(new Event("change", { bubbles: true })) })
    await type("termination-note", "Ödəniş yoxdur")
    const input = field("termination-agreement")
    Object.defineProperty(input, "files", { value: [new File(["%PDF-"], "xitam.pdf", { type: "application/pdf" })], configurable: true })
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })) })
    await submit("terminate-form")
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ url: "/api/v1/contracts/ctr-1/terminate", method: "POST" })
    const body = sent[0].body as FormData
    expect([body.get("terminationDate"), body.get("reason"), body.get("note"), (body.get("file") as File).name]).toEqual(["2026-12-01", "breach", "Ödəniş yoxdur", "xitam.pdf"])
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it("a refusal is said in words and the window stays", async () => {
    reply = { status: 409, json: { code: "ALREADY_SCHEDULED" } }
    const onDone = await open()
    await submit("terminate-form")
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("closing.errors.ALREADY_SCHEDULED")
    expect(q("terminate-form")).not.toBeNull()
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe("«Отменить договор»", () => {
  it("sends nothing without a reason, then the reason", async () => {
    const onDone = vi.fn()
    await act(async () => root.render(createElement(ContractCancelDialog, { open: true, onOpenChange: vi.fn(), contractId: "ctr-2", onDone })))
    await submit("cancel-form")
    expect(sent).toEqual([])
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("closing.errors.REASON_REQUIRED")
    await type("cancel-reason", "Dublikat")
    await submit("cancel-form")
    expect(sent).toEqual([{ url: "/api/v1/contracts/ctr-2/cancel", method: "POST", body: { reason: "Dublikat" } }])
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

describe("the line under the header", () => {
  const info = { recordedBy: "Rashad", file: { id: "f1", fileName: "abc.pdf", originalName: "xitam.pdf", mimeType: "application/pdf" } }

  it("a termination to come: the day, the reason, who — and «Отменить расторжение»", async () => {
    const onChanged = vi.fn()
    await act(async () => root.render(createElement(ContractClosingBanner, {
      contractId: "ctr-3",
      state: { status: "active", terminationDate: "2026-12-01T00:00:00.000Z", terminationReason: "mutual_agreement", closeNote: null, closedAt: "2026-11-26T09:00:00.000Z" },
      info,
      onChanged,
    })))
    expect(q("closing-banner")?.textContent).toContain('closing.bannerScheduled{"date":"01.12.2026"} · closing.reasons.mutual_agreement · closing.recordedBy{"name":"Rashad"}')
    expect(await readHint(q("closing-withdraw"))).toBe("closing.withdrawHint")
    await act(async () => q("closing-withdraw")!.click())
    await flush()
    expect(sent).toEqual([{ url: "/api/v1/contracts/ctr-3/terminate", method: "DELETE", body: null }])
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it("a termination done: no withdrawal, the agreement opens", async () => {
    await act(async () => root.render(createElement(ContractClosingBanner, {
      contractId: "ctr-3",
      state: { status: "terminated", terminationDate: "2026-11-26T00:00:00.000Z", terminationReason: "breach", closeNote: "Ödəniş yoxdur", closedAt: "2026-11-26T09:00:00.000Z" },
      info,
      onChanged: vi.fn(),
    })))
    expect(q("closing-banner")?.textContent).toContain('closing.bannerTerminated{"date":"26.11.2026"} · closing.reasons.breach · Ödəniş yoxdur')
    expect(q("closing-withdraw")).toBeNull()
    expect(container.querySelector('a[href="/uploads/contracts/abc.pdf"]')?.textContent).toBe("closing.openAgreement")
  })

  it("a cancellation: the day and the reason; nothing for a contract still in force", async () => {
    await act(async () => root.render(createElement(ContractClosingBanner, {
      contractId: "ctr-4",
      state: { status: "cancelled", terminationDate: null, terminationReason: null, closeNote: "Dublikat", closedAt: "2026-11-26T09:00:00.000Z" },
      info: { recordedBy: null, file: null },
      onChanged: vi.fn(),
    })))
    expect(q("closing-banner")?.textContent).toBe('closing.bannerCancelled{"date":"26.11.2026"} · Dublikat')
    await act(async () => root.render(createElement(ContractClosingBanner, {
      contractId: "ctr-5",
      state: { status: "active", terminationDate: null, terminationReason: null, closeNote: null, closedAt: null },
      info: null,
      onChanged: vi.fn(),
    })))
    expect(q("closing-banner")).toBeNull()
  })
})

it("«Вернуть в черновик» says what it does and asks the server", async () => {
  const onDone = vi.fn()
  await act(async () => root.render(createElement(ContractReopenButton, { contractId: "ctr-6", onDone })))
  expect(await readHint(q("contract-reopen"))).toBe("closing.reopenHint")
  await act(async () => q("contract-reopen")!.click())
  await flush()
  expect(sent).toEqual([{ url: "/api/v1/contracts/ctr-6/reopen", method: "POST", body: null }])
  expect(onDone).toHaveBeenCalledTimes(1)
})
