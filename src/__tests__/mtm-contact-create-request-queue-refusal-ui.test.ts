// @vitest-environment jsdom
/**
 * The new-client request queue sits above the Clients list for whoever may
 * decide the requests. For everyone else the API refuses it, and that refusal
 * is not an error on their screen.
 *
 * Reported 2026-10-03: a red "Forbidden" toast on every visit to Clients for a
 * login without an employee card — the same toast a field agent got.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const toastError = vi.fn()
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() } }))
vi.mock("next-intl", () => ({ useLocale: () => "ru" }))

import { ContactCreateRequestQueue } from "@/components/mtm/contact-create-request-queue"

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()

async function render(status: number, body: unknown) {
  fetchMock.mockResolvedValue({ status, ok: status < 400, json: async () => body })
  await act(async () => { root.render(createElement(ContactCreateRequestQueue)) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  return document.querySelector('[data-testid="mtm-contact-create-requests"]')
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  toastError.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("new-client request queue", () => {
  it("is simply absent for a caller the API refuses — no toast", async () => {
    expect(await render(403, { error: "Forbidden" })).toBeNull()
    expect(toastError).not.toHaveBeenCalled()
  })

  it("still reports a real failure", async () => {
    expect(await render(500, { error: "Failed to load requests" })).toBeNull()
    expect(toastError).toHaveBeenCalledWith("Failed to load requests")
  })

  it("shows the requests to someone who may decide them", async () => {
    const queue = await render(200, {
      success: true,
      data: { requests: [{ id: "r-1", displayName: "Dr. Aliyev", clinicName: "Klinika", requestedByAgent: { id: "a-1", name: "Seymur" } }] },
    })
    expect(queue?.textContent).toContain("Dr. Aliyev")
    expect(toastError).not.toHaveBeenCalled()
  })
})
