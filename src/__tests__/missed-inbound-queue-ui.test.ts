// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  MissedInboundQueue,
  normalizeMissedInboundQueuePayload,
} from "@/components/voip/missed-inbound-queue"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => key,
}))

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, info: mocks.toastInfo },
}))

const item = {
  taskId: "call_missed_inbound_call-1",
  status: "pending",
  missedAt: "2026-08-27T08:30:00.000Z",
  leadId: "lead/unsafe",
}

let container: HTMLDivElement
let root: Root

function response(status: number, payload: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
  })
}

async function renderQueue() {
  await act(async () => {
    root.render(createElement(MissedInboundQueue))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("missed inbound manager queue UI", () => {
  it("normalizes only the four safe fields and rejects malformed payloads", () => {
    expect(normalizeMissedInboundQueuePayload({
      success: true,
      data: [{
        ...item,
        fromNumber: "+994501112233",
        providerCallId: "private-provider-id",
      }],
    })).toEqual([item])
    expect(normalizeMissedInboundQueuePayload({ success: true, data: [{ taskId: 1 }] })).toEqual([])
    expect(normalizeMissedInboundQueuePayload({ error: "no" })).toBeNull()
  })

  it("is mounted only for manager roles and intentionally appears on both VoIP aliases", () => {
    const supportPage = readFileSync(
      "src/app/(dashboard)/support/voip/page.tsx",
      "utf8",
    )
    const inboxAlias = readFileSync(
      "src/app/(dashboard)/inbox/voip/page.tsx",
      "utf8",
    )

    expect(supportPage).toContain("isManagerOrAbove")
    expect(supportPage).toContain("<MissedInboundQueue")
    expect(supportPage).toMatch(
      /isManagerOrAbove\(session\?\.user\?\.role\s*\?\?\s*["']["']\)/u,
    )
    expect(inboxAlias).toContain('import VoipCallsPage from "../../support/voip/page"')
  })

  it("shows a useful empty state after a successful load", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response(200, { success: true, data: [] })))

    await renderQueue()

    expect(container.textContent).toContain("emptyTitle")
    expect(container.textContent).toContain("emptyDescription")
  })

  it("shows an actionable error and retries the same safe list endpoint", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error("offline")))
      .mockImplementationOnce(() => response(200, { success: true, data: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await renderQueue()
    expect(container.textContent).toContain("loadError")

    const retry = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("retry"))
    expect(retry).toBeTruthy()
    await act(async () => retry?.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/calls/missed-inbound-queue",
      expect.objectContaining({ cache: "no-store" }),
    )
  })

  it("claims with an empty JSON command and navigates only after the 200 winner response", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response(200, { success: true, data: [{
        ...item,
        fromNumber: "+994501112233",
        providerCallId: "private-provider-id",
      }] }))
      .mockImplementationOnce(() => response(200, {
        success: true,
        data: { taskId: item.taskId, leadId: item.leadId },
      }))
    vi.stubGlobal("fetch", fetchMock)

    await renderQueue()
    expect(container.textContent).toContain("claimAndOpen")
    expect(container.textContent).not.toContain("+994501112233")
    expect(container.textContent).not.toContain("private-provider-id")

    const claim = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("claimAndOpen"))
    await act(async () => claim?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/v1/calls/missed-inbound-queue/${encodeURIComponent(item.taskId)}/claim`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    )
    expect(mocks.routerPush).toHaveBeenCalledWith("/leads/lead%2Funsafe")
  })

  it("stays put and refreshes when another manager wins the 409 race", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response(200, { success: true, data: [item] }))
      .mockImplementationOnce(() => response(409, { error: "missed_inbound_already_claimed" }))
      .mockImplementationOnce(() => response(200, { success: true, data: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await renderQueue()
    const claim = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("claimAndOpen"))
    await act(async () => claim?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mocks.routerPush).not.toHaveBeenCalled()
    expect(mocks.toastInfo).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(container.textContent).toContain("emptyTitle")
  })

  it("contains responsive touch targets, no phone/provider surface and no call side effect", () => {
    const source = readFileSync(
      "src/components/voip/missed-inbound-queue.tsx",
      "utf8",
    )

    expect(source).toContain("sm:flex-row")
    expect(source).toContain("min-h-11")
    expect(source).toContain("/api/v1/calls/missed-inbound-queue")
    for (const forbidden of [
      "fromNumber",
      "toNumber",
      "targetPhoneE164",
      "providerCallId",
      "recordingUrl",
      "/ai-call",
      "/browser-answer",
      "getVoipProvider",
      "initiateCall",
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })

  it("has complete Azerbaijani, Russian and English copy", () => {
    for (const locale of ["en", "ru", "az"] as const) {
      const messages = JSON.parse(
        readFileSync(`messages/${locale}.json`, "utf8"),
      ) as { voip: { missedInboundQueue?: Record<string, string> } }
      const copy = messages.voip.missedInboundQueue
      expect(copy).toBeTruthy()
      for (const key of [
        "title",
        "description",
        "emptyTitle",
        "emptyDescription",
        "loadError",
        "retry",
        "claimAndOpen",
        "claimedElsewhere",
        "claimFailed",
        "missedAt",
      ]) {
        expect(copy?.[key]).toBeTruthy()
      }
    }
  })
})
