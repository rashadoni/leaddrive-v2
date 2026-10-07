// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  translate: vi.fn((key: string) => key),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { organizationId: "org-workforce" } } }),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => mocks.translate,
}))

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string }) => (
    createElement("a", { href, ...props }, children)
  ),
}))

vi.mock("@/components/page-description", () => ({
  PageDescription: ({ title, description }: { title: string; description: string }) => (
    createElement("header", null, createElement("h1", null, title), createElement("p", null, description))
  ),
}))

import { WorkforceExceptionQueue } from "@/components/workforce/workforce-exception-queue"

const ACK_TOKEN = "v1:ack-token-ciphertext"
const CORRECTION_TOKEN = "v1:correction-token-ciphertext"
const FIXED_OPERATION_ID = "00000000-0000-4000-8000-000000000001"

type DecisionAction = { decisionCode: string; actionToken: string }
type MockResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

function queueItem(reference: string, actions: DecisionAction[]) {
  return {
    displayReference: reference,
    employeeDisplayName: `Employee ${reference}`,
    type: "LATE_START",
    triageSeverity: "ROUTINE_REVIEW",
    ageSeconds: 60,
    stage: "OPEN",
    evidenceState: "NOT_REQUIRED",
    employeeResponse: "NOT_REQUESTED",
    nextAction: "ACKNOWLEDGE_HR_REVIEW",
    decisionContext: {
      correctionState: "NOT_REQUESTED",
      employeeVisibility: "NOT_RECORDED",
      actions,
    },
  }
}

function response(status: number, payload: unknown): Promise<MockResponse> {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

type QueueResponseItem = ReturnType<typeof queueItem> & {
  outcomeContext?: { classification: string | null; appeal: string | null; actions: DecisionAction[] }
}

function queueResponse(items: QueueResponseItem[]) {
  return response(200, { success: true, data: { cases: items } })
}

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function renderQueue() {
  await act(async () => {
    root.render(createElement(WorkforceExceptionQueue))
  })
  await flush()
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(label))
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

function buttons(label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll("button"))
    .filter((candidate) => candidate.textContent?.includes(label))
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(FIXED_OPERATION_ID)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("Workforce exception review-action UI", () => {
  it("keeps the fixed privacy and accessibility contract localized in all three locales", () => {
    const requiredKeys = [
      "reviewAction",
      "noActionAvailable",
      "actionFormTitle",
      "serverChecksHint",
      "cancelAction",
      "recordAction",
      "actionRecorded",
      "mfaRequired",
      "actionStale",
      "actionRateLimited",
      "actionFailed",
    ]
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
        .workforceExceptionQueue as Record<string, unknown>
      for (const key of requiredKeys) {
        expect(messages[key], `${locale}.${key}`).toEqual(expect.any(String))
        expect((messages[key] as string).trim(), `${locale}.${key}`).not.toBe("")
      }
      expect((messages.actions as Record<string, unknown>).ACKNOWLEDGE).toEqual(expect.any(String))
      expect((messages.actionHints as Record<string, unknown>).ACKNOWLEDGE).toEqual(expect.any(String))
      expect((messages.actions as Record<string, unknown>).REQUEST_TIME_CORRECTION).toEqual(expect.any(String))
      expect((messages.actionHints as Record<string, unknown>).REQUEST_TIME_CORRECTION).toEqual(expect.any(String))
    }

    const source = readFileSync("src/components/workforce/workforce-exception-queue.tsx", "utf8")
    expect(source).toContain('const QUEUE_DECISION_CODES = ["ACKNOWLEDGE", "REQUEST_TIME_CORRECTION"] as const')
    expect(source).toContain('ACKNOWLEDGE: "MANAGER_ACKNOWLEDGED_FOR_HUMAN_REVIEW"')
    expect(source).toContain('REQUEST_TIME_CORRECTION: "MANAGER_REQUESTED_TIME_CORRECTION_FOR_REVIEW"')
    expect(source).toContain('className="min-h-11 whitespace-normal text-left"')
    expect(source).toContain("onClick={() => closeAction()}")
    expect(source).not.toContain("onClick={closeAction}")
    expect(source).not.toMatch(/localStorage|sessionStorage|console\./)
  })

  it("renders only exact server-offered acknowledgement/correction actions and never exposes their tokens", async () => {
    vi.stubGlobal("fetch", vi.fn(() => queueResponse([
      queueItem("WF-ACK", [{ decisionCode: "ACKNOWLEDGE", actionToken: ACK_TOKEN }]),
      queueItem("WF-RESPONSE", [{ decisionCode: "REQUEST_EMPLOYEE_RESPONSE", actionToken: "response-secret" }]),
      queueItem("WF-CORRECTION", [{ decisionCode: "REQUEST_TIME_CORRECTION", actionToken: "correction-secret" }]),
      queueItem("WF-TERMINAL", [{ decisionCode: "RESOLVE_NO_CHANGE", actionToken: "terminal-secret" }]),
      queueItem("WF-EMPTY", [{ decisionCode: "ACKNOWLEDGE", actionToken: "" }]),
      queueItem("WF-DUPLICATE", [
        { decisionCode: "ACKNOWLEDGE", actionToken: "duplicate-secret-one" },
        { decisionCode: "ACKNOWLEDGE", actionToken: "duplicate-secret-two" },
      ]),
      queueItem("WF-MULTI-ALLOWED", [
        { decisionCode: "ACKNOWLEDGE", actionToken: "multi-ack-secret" },
        { decisionCode: "REQUEST_TIME_CORRECTION", actionToken: "multi-correction-secret" },
      ]),
    ])))

    await renderQueue()

    expect(container.textContent?.match(/actions\.ACKNOWLEDGE/g)).toHaveLength(1)
    expect(container.textContent?.match(/actions\.REQUEST_TIME_CORRECTION/g)).toHaveLength(1)
    expect(container.textContent).not.toMatch(/REQUEST_EMPLOYEE_RESPONSE|RESOLVE_NO_CHANGE/)
    expect(container.innerHTML).not.toMatch(/ack-token-ciphertext|response-secret|correction-secret|terminal-secret|duplicate-secret|multi-ack-secret|multi-correction-secret/)
  })

  it("records a correction request with only its token, stable operation id and fixed safe reason", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => queueResponse([
        queueItem("WF-CORRECTION", [{ decisionCode: "REQUEST_TIME_CORRECTION", actionToken: CORRECTION_TOKEN }]),
      ]))
      .mockImplementationOnce(() => response(201, {
        success: true,
        idempotent: false,
        data: { decisionCode: "REQUEST_TIME_CORRECTION" },
      }))
      .mockImplementationOnce(() => queueResponse([queueItem("WF-CORRECTION", [])]))
    vi.stubGlobal("fetch", fetchMock)

    await renderQueue()
    await act(async () => button("actions.REQUEST_TIME_CORRECTION").click())

    expect(container.textContent).toContain("actionHints.REQUEST_TIME_CORRECTION")
    expect(container.querySelector("textarea, input")).toBeNull()

    await act(async () => button("recordAction").click())
    await flush()

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/workforce/exception-decisions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-organization-id": "org-workforce",
      },
      body: JSON.stringify({
        actionToken: CORRECTION_TOKEN,
        operationId: FIXED_OPERATION_ID,
        reason: "MANAGER_REQUESTED_TIME_CORRECTION_FOR_REVIEW",
      }),
    })
    const body = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string)
    expect(body).not.toHaveProperty("caseId")
    expect(body).not.toHaveProperty("decisionCode")
    expect(body).not.toHaveProperty("employeeReason")
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/workforce/exceptions", expect.objectContaining({
      headers: { "x-organization-id": "org-workforce" },
    }))
    expect(container.textContent).toContain("actionRecorded")
  })

  it("uses a two-step confirmation and posts only the token, stable operation id and fixed safe reason", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => queueResponse([
        queueItem("WF-ACK", [{ decisionCode: "ACKNOWLEDGE", actionToken: ACK_TOKEN }]),
      ]))
      .mockImplementationOnce(() => response(201, {
        success: true,
        idempotent: false,
        data: { decisionCode: "ACKNOWLEDGE" },
      }))
      .mockImplementationOnce(() => queueResponse([
        queueItem("WF-ACK", []),
      ]))
    vi.stubGlobal("fetch", fetchMock)

    await renderQueue()
    await act(async () => button("actions.ACKNOWLEDGE").click())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="workforce-exception-action-panel"]')).not.toBeNull()
    expect(container.querySelector("textarea, input")).toBeNull()

    await act(async () => button("recordAction").click())
    await flush()

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/workforce/exception-decisions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-organization-id": "org-workforce",
      },
      body: JSON.stringify({
        actionToken: ACK_TOKEN,
        operationId: FIXED_OPERATION_ID,
        reason: "MANAGER_ACKNOWLEDGED_FOR_HUMAN_REVIEW",
      }),
    })
    const body = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string)
    expect(body).not.toHaveProperty("caseId")
    expect(body).not.toHaveProperty("decisionCode")
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/workforce/exceptions", expect.objectContaining({
      headers: { "x-organization-id": "org-workforce" },
    }))
    expect(container.textContent).toContain("actionRecorded")
  })

  it("replays the same in-memory operation after an uncertain network failure", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => queueResponse([
        queueItem("WF-ACK", [{ decisionCode: "ACKNOWLEDGE", actionToken: ACK_TOKEN }]),
      ]))
      .mockImplementationOnce(() => Promise.reject(new Error("connection lost after send")))
      .mockImplementationOnce(() => response(200, {
        success: true,
        idempotent: true,
        data: { decisionCode: "ACKNOWLEDGE" },
      }))
      .mockImplementationOnce(() => queueResponse([queueItem("WF-ACK", [])]))
    vi.stubGlobal("fetch", fetchMock)

    await renderQueue()
    await act(async () => button("actions.ACKNOWLEDGE").click())
    await act(async () => button("recordAction").click())
    await flush()
    expect(container.textContent).toContain("actionFailed")

    await act(async () => button("cancelAction").click())
    await act(async () => button("actions.ACKNOWLEDGE").click())
    await act(async () => button("recordAction").click())
    await flush()

    const firstBody = (fetchMock.mock.calls[1]?.[1] as RequestInit).body
    const retryBody = (fetchMock.mock.calls[2]?.[1] as RequestInit).body
    expect(retryBody).toBe(firstBody)
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1)
  })

  it("locks every action trigger to the submitted token until a deferred POST settles", async () => {
    const pendingPost = deferred<MockResponse>()
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => queueResponse([
        queueItem("WF-FIRST", [{ decisionCode: "ACKNOWLEDGE", actionToken: "v1:first-token" }]),
        queueItem("WF-SECOND", [{ decisionCode: "ACKNOWLEDGE", actionToken: "v1:second-token" }]),
      ]))
      .mockImplementationOnce(() => pendingPost.promise)
      .mockImplementationOnce(() => queueResponse([
        queueItem("WF-FIRST", []),
        queueItem("WF-SECOND", [{ decisionCode: "ACKNOWLEDGE", actionToken: "v1:second-token-new" }]),
      ]))
    vi.stubGlobal("fetch", fetchMock)

    await renderQueue()
    const actionTriggers = buttons("actions.ACKNOWLEDGE")
    expect(actionTriggers).toHaveLength(2)
    await act(async () => actionTriggers[0]?.click())
    await act(async () => {
      button("recordAction").click()
      button("cancelAction").click()
      actionTriggers[1]?.click()
    })

    expect(actionTriggers[0]?.disabled).toBe(true)
    expect(actionTriggers[1]?.disabled).toBe(true)
    expect(button("refresh").disabled).toBe(true)
    expect(button("cancelAction").disabled).toBe(true)
    expect(container.querySelector('[data-testid="workforce-exception-action-panel"]')).not.toBeNull()
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1)

    await act(async () => {
      pendingPost.resolve({
        ok: true,
        status: 201,
        json: () => Promise.resolve({
          success: true,
          data: { decisionCode: "ACKNOWLEDGE" },
        }),
      })
      await pendingPost.promise
    })
    await flush()

    const posted = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string)
    expect(posted).toMatchObject({
      actionToken: "v1:first-token",
      operationId: FIXED_OPERATION_ID,
    })
    expect(container.textContent).toContain("actionRecorded")
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("discards a stale token, shows generic copy and refreshes the queue", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => queueResponse([
        queueItem("WF-ACK", [{ decisionCode: "ACKNOWLEDGE", actionToken: ACK_TOKEN }]),
      ]))
      .mockImplementationOnce(() => response(409, {
        code: "PRIVATE_INTERNAL_CONFLICT",
        error: "case_123 changed for employee_456",
      }))
      .mockImplementationOnce(() => queueResponse([queueItem("WF-ACK", [])]))
    vi.stubGlobal("fetch", fetchMock)

    await renderQueue()
    await act(async () => button("actions.ACKNOWLEDGE").click())
    await act(async () => button("recordAction").click())
    await flush()

    expect(container.textContent).toContain("actionStale")
    expect(container.textContent).not.toMatch(/PRIVATE_INTERNAL_CONFLICT|case_123|employee_456/)
    expect(container.querySelector('[data-testid="workforce-exception-action-panel"]')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("does not accept a success envelope for a different decision", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => queueResponse([
        queueItem("WF-ACK", [{ decisionCode: "ACKNOWLEDGE", actionToken: ACK_TOKEN }]),
      ]))
      .mockImplementationOnce(() => response(201, {
        success: true,
        data: { decisionCode: "REQUEST_EMPLOYEE_RESPONSE" },
      }))
    vi.stubGlobal("fetch", fetchMock)

    await renderQueue()
    await act(async () => button("actions.ACKNOWLEDGE").click())
    await act(async () => button("recordAction").click())
    await flush()

    expect(container.textContent).toContain("actionFailed")
    expect(container.textContent).not.toContain("actionRecorded")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe("separate explicit HR findings in the exception queue", () => {
  it("requires a protected HR reason and freezes it for an exact retry after a lost response", async () => {
    const item = { ...queueItem("WF-HR", []), stage: "RESOLVED", outcomeContext: { classification: null, appeal: null, actions: [{ decisionCode: "APPEAL_PARTIALLY_UPHELD", actionToken: "v1:hr-outcome-private-token" }] } }
    const fetchMock = vi.fn().mockImplementationOnce(() => queueResponse([item])).mockRejectedValueOnce(new Error("lost response")).mockImplementationOnce(() => response(201, { success: true, data: { decisionCode: "APPEAL_PARTIALLY_UPHELD" } })).mockImplementationOnce(() => queueResponse([{ ...item, outcomeContext: { ...item.outcomeContext, actions: [] } }]))
    vi.stubGlobal("fetch",fetchMock)
    await renderQueue()
    await act(async () => button("actions.APPEAL_PARTIALLY_UPHELD").click())
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[name="reason"]')!
    expect(textarea.required).toBe(true)
    expect(container.innerHTML).not.toContain("v1:hr-outcome-private-token")
    await act(async () => {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!
      nativeSetter.call(textarea,"Private reviewed reason.")
      textarea.dispatchEvent(new Event("input",{ bubbles: true }))
    })
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit",{ bubbles: true, cancelable: true })) })
    await flush()
    expect(textarea.disabled).toBe(true)
    expect(container.textContent).toContain("actionFailed")
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit",{ bubbles: true, cancelable: true })) })
    await flush()
    const first = JSON.parse(fetchMock.mock.calls[1][1].body)
    const retry = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(first).toEqual({ actionToken: "v1:hr-outcome-private-token", operationId: FIXED_OPERATION_ID, reason: "Private reviewed reason." })
    expect(retry).toEqual(first)
    expect(container.querySelector('textarea[name="reason"]')).toBeNull()
    expect(container.innerHTML).not.toContain("Private reviewed reason.")
  })
})
