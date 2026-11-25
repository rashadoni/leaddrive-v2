// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }) }))
vi.mock("next-intl", () => ({
  useLocale: () => "az",
  useTranslations: () => {
    const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}${JSON.stringify(values)}` : key)
    translate.has = () => true
    return translate
  },
}))

// The confirmation is the shared dialog; here it is a button that confirms when open.
vi.mock("@/components/delete-confirm-dialog", async () => {
  const React = await import("react")
  return {
    ConfirmDialog: ({ open, onConfirm, confirmLabel }: { open: boolean; onConfirm: () => Promise<void>; confirmLabel?: string }) =>
      open ? React.createElement("button", { "data-testid": "confirm-dialog", onClick: () => void onConfirm() }, confirmLabel) : null,
  }
})

import { ContractDocumentSigning } from "@/components/contracts/contract-document-signing"
import { readHint } from "./helpers/hint"

/**
 * The «İmza» block on a protocol's or act's page: who signs (the people who
 * signed the contract come first), the links after sending, who signed while
 * it is out, the recall, and the signature sheet once it is signed. React in
 * jsdom; the server is `fetch`.
 */
let container: HTMLDivElement
let root: Root
const sent: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = []
let responses: Record<string, unknown> = {}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  sent.length = 0
  responses = {}
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      sent.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
      const reply = responses[`${method} ${url.split("?")[0]}`]
      return reply === undefined ? ({ ok: false, status: 404, json: async () => ({}) } as Response) : ({ ok: true, status: 200, json: async () => reply } as Response)
    }),
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)) })
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
const click = async (el: Element | null) => { await act(async () => (el as HTMLElement).click()); await flush() }
const BASE = "/api/v1/contracts/ctr-1/documents/pp-1"

async function render(status: "draft" | "in_signing" | "signed", over: { unsaved?: boolean; hasLines?: boolean } = {}) {
  const onChanged = vi.fn()
  await act(async () =>
    root.render(createElement(ContractDocumentSigning, { contractId: "ctr-1", docId: "pp-1", status, hasLines: over.hasLines ?? true, unsaved: over.unsaved ?? false, onChanged })),
  )
  await flush()
  return onChanged
}

describe("sending a document for signing", () => {
  it("offers the contract's signers, sends the saved document, and shows the links", async () => {
    responses[`GET ${BASE}/esign`] = { success: true, data: { envelopes: [] } }
    responses["GET /api/v1/contracts/ctr-1/esign"] = {
      success: true,
      data: [{ id: "env-c", status: "completed", signers: [{ id: "a", fullName: "Rəşad", email: "r@x.az", role: "signer" }, { id: "b", fullName: "Mühasib", email: "acc@x.az", role: "cc" }, { id: "c", fullName: "Fərid", email: "f@kaspi.az", role: "signer" }] }],
    }
    responses[`POST ${BASE}/esign`] = { success: true, data: { signingLinks: [{ signerId: "s1", fullName: "Rəşad", email: "r@x.az", signingLink: "https://app/sign/t1" }] } }
    const onChanged = await render("draft")
    await click(q("document-send-open"))
    expect((container.querySelector("#signer-name-0") as HTMLInputElement).value).toBe("Rəşad")
    expect((container.querySelector("#signer-email-1") as HTMLInputElement).value).toBe("f@kaspi.az")
    expect(container.querySelector("#signer-name-2")).toBeNull() // a copy recipient of the contract does not sign the protocol
    await click(q("document-send"))
    expect(sent.find((s) => s.method === "POST")?.body).toEqual({ signers: [{ fullName: "Rəşad", email: "r@x.az" }, { fullName: "Fərid", email: "f@kaspi.az" }], lang: "az" })
    expect(q("document-signing-links")?.textContent).toContain("Rəşad · r@x.az")
    expect(onChanged).toHaveBeenCalled()
  })

  it("asks to save first while there are unsaved edits", async () => {
    responses[`GET ${BASE}/esign`] = { success: true, data: { envelopes: [] } }
    await render("draft", { unsaved: true })
    const open = q("document-send-open")! as HTMLButtonElement
    expect(open.disabled).toBe(true)
    expect(await readHint(open.closest("span") ?? open)).toBe("saveFirst")
  })
})

describe("while it is out for signing, and once it is signed", () => {
  const envelope = (status: string, signerStatus: string) => ({
    id: "env-d", status, sentAt: "2026-11-25T10:00:00Z", completedAt: status === "completed" ? "2026-11-26T10:00:00Z" : null, boundContentHash: "ab".repeat(32),
    signers: [{ id: "s1", fullName: "Fərid", email: "f@kaspi.az", order: 1, role: "signer", status: signerStatus, signedAt: signerStatus === "signed" ? "2026-11-26T10:00:00Z" : null, signatureMethod: "typed", signedIpAddress: "5.191.10.4" }],
  })

  it("shows who has not signed yet and recalls the document", async () => {
    responses[`GET ${BASE}/esign`] = { success: true, data: { envelopes: [envelope("in_progress", "viewed")] } }
    responses[`DELETE ${BASE}/esign`] = { success: true }
    const onChanged = await render("in_signing")
    expect(q("document-in-signing")?.textContent).toContain("signer_viewed")
    await click(q("document-recall"))
    expect(sent.some((s) => s.method === "DELETE")).toBe(false) // nothing happens before the confirmation
    await click(q("confirm-dialog"))
    expect(sent.find((s) => s.method === "DELETE")?.url).toBe(`${BASE}/esign`)
    expect(onChanged).toHaveBeenCalled()
  })

  it("shows the signature sheet with the signed PDF", async () => {
    responses[`GET ${BASE}/esign`] = { success: true, data: { envelopes: [envelope("completed", "signed")] } }
    await render("signed")
    const sheet = q("esign-signature-sheet")!
    expect(sheet.textContent).toContain("Fərid")
    expect(sheet.textContent).toContain("esignFingerprintPlain")
    const open = vi.fn()
    vi.stubGlobal("open", open)
    await click([...sheet.querySelectorAll("button")].find((b) => b.textContent?.includes("esignSignedPdf"))!)
    expect(open.mock.calls[0][0]).toMatch(/^\/api\/v1\/contracts\/ctr-1\/documents\/pp-1\/pdf\?lang=az&signed=1&download=1&tz=/)
  })
})
