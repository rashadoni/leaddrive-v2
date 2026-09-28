// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  organizationId: "org-a",
  userId: "user-a",
  translate: vi.fn((key: string) => key),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: mocks.userId, organizationId: mocks.organizationId } } }),
}))

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => mocks.translate,
}))

vi.mock("@/components/page-description", () => ({
  PageDescription: ({ title, description }: { title: string; description: string }) => (
    createElement("header", null, createElement("h1", null, title), createElement("p", null, description))
  ),
}))

import { WorkforceEvidenceTimeline } from "@/components/workforce/workforce-evidence-timeline"

type MockResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
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
  const promise = new Promise<T>((onResolve) => { resolve = onResolve })
  return { promise, resolve }
}

function timelineData(url: string, employee: { id: string; name: string }, caseReference: string) {
  const params = new URL(url, "http://localhost").searchParams
  return {
    success: true,
    data: {
      timezone: "Asia/Baku",
      start: params.get("start"),
      end: params.get("end"),
      employee,
      access: {
        purpose: "ATTENDANCE_REVIEW",
        reasonCode: "OPEN_EXCEPTION",
        caseReference,
      },
      boundaries: {
        projection: "DERIVED_ONLY",
        rawEvidence: "NOT_RETURNED",
        physicalPresence: "VERDICT_IS_NOT_IDENTITY_OR_PRESENCE_PROOF",
      },
      evidence: [],
    },
  }
}

let container: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

function field(id: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`#${id}`)
  if (!input) throw new Error(`Missing input: ${id}`)
  return input
}

function selectField(id: string): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(`#${id}`)
  if (!select) throw new Error(`Missing select: ${id}`)
  return select
}

async function typeInto(id: string, value: string) {
  const input = field(id)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function selectValue(id: string, value: string) {
  const select = selectField(id)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value)
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

async function chooseReviewContext() {
  await selectValue("evidence-purpose", "ATTENDANCE_REVIEW")
  await selectValue("evidence-reason", "OPEN_EXCEPTION")
}

async function chooseDateRange() {
  await typeInto("evidence-start", "2026-09-01")
  await typeInto("evidence-end", "2026-09-07")
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(label))
  if (!match) throw new Error(`Missing button: ${label}`)
  return match
}

beforeEach(() => {
  mocks.organizationId = "org-a"
  mocks.userId = "user-a"
  vi.clearAllMocks()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("Workforce evidence timeline session-scope fence", () => {
  it("clears sensitive state and stale reads on tenant and same-tenant principal switches", async () => {
    const oldTimeline = deferred<MockResponse>()
    const oldPrincipalTimeline = deferred<MockResponse>()
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => response(200, {
        success: true,
        data: { items: [{ id: "agent-a", label: "Aysel Tenant A" }], hasMore: false },
      }))
      .mockImplementationOnce(() => oldTimeline.promise)
      .mockImplementationOnce(() => response(200, {
        success: true,
        data: { items: [{ id: "agent-b", label: "Bora Tenant B" }], hasMore: false },
      }))
      .mockImplementationOnce(() => oldPrincipalTimeline.promise)
    vi.stubGlobal("fetch", fetchMock)

    await act(async () => root.render(createElement(WorkforceEvidenceTimeline)))
    await typeInto("evidence-employee-search", "Ay")
    await act(async () => {
      field("evidence-employee-search").dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }))
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(container.textContent).toContain("contextRequired")

    await chooseReviewContext()
    await typeInto("evidence-case-reference", "case-a")
    await typeInto("evidence-employee-search", "Ay")
    await act(async () => button("searchEmployees").click())
    await flush()
    await act(async () => button("Aysel Tenant A").click())
    expect(document.activeElement).toBe(button("changeEmployee"))
    await chooseDateRange()
    await act(async () => button("loadTimeline").click())
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({
      "x-organization-id": "org-a",
      "x-workforce-case-reference": "case-a",
    })
    const oldSignal = (fetchMock.mock.calls[1]?.[1] as RequestInit).signal as AbortSignal
    const oldTimelineUrl = fetchMock.mock.calls[1]?.[0] as string

    mocks.organizationId = "org-b"
    mocks.userId = "user-b"
    await act(async () => root.render(createElement(WorkforceEvidenceTimeline)))

    expect(oldSignal.aborted).toBe(true)
    expect(field("evidence-case-reference").value).toBe("")
    expect(field("evidence-employee-search").value).toBe("")
    expect(container.textContent).not.toContain("Aysel Tenant A")

    oldTimeline.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(timelineData(
        oldTimelineUrl,
        { id: "agent-a", name: "Aysel Tenant A" },
        "case-a",
      )),
    })
    await flush()
    expect(container.textContent).not.toContain("Aysel Tenant A")

    await chooseReviewContext()
    await typeInto("evidence-case-reference", "case-b")
    await typeInto("evidence-employee-search", "Bo")
    await act(async () => button("searchEmployees").click())
    await flush()

    expect(container.textContent).toContain("Bora Tenant B")
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).headers).toMatchObject({
      "x-organization-id": "org-b",
      "x-workforce-access-purpose": "ATTENDANCE_REVIEW",
      "x-workforce-access-reason-code": "OPEN_EXCEPTION",
      "x-workforce-case-reference": "case-b",
    })
    expect(JSON.stringify((fetchMock.mock.calls[2]?.[1] as RequestInit).headers)).not.toContain("case-a")

    await act(async () => button("Bora Tenant B").click())
    await chooseDateRange()
    await act(async () => button("loadTimeline").click())
    await flush()
    const oldPrincipalSignal = (fetchMock.mock.calls[3]?.[1] as RequestInit).signal as AbortSignal
    const oldPrincipalTimelineUrl = fetchMock.mock.calls[3]?.[0] as string

    mocks.userId = "user-c"
    await act(async () => root.render(createElement(WorkforceEvidenceTimeline)))

    expect(oldPrincipalSignal.aborted).toBe(true)
    expect(field("evidence-case-reference").value).toBe("")
    expect(field("evidence-employee-search").value).toBe("")
    expect(container.textContent).not.toContain("Bora Tenant B")

    oldPrincipalTimeline.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(timelineData(
        oldPrincipalTimelineUrl,
        { id: "agent-b", name: "Bora Tenant B" },
        "case-b",
      )),
    })
    await flush()
    expect(container.textContent).not.toContain("Bora Tenant B")
  })

  it("moves focus to the selected employee control and back to search when changing it", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response(200, {
      success: true,
      data: { items: [{ id: "agent-a", label: "Aysel Tenant A" }], hasMore: false },
    })))

    await act(async () => root.render(createElement(WorkforceEvidenceTimeline)))
    await chooseReviewContext()
    await typeInto("evidence-employee-search", "Ay")
    await act(async () => button("searchEmployees").click())
    await flush()

    await act(async () => button("Aysel Tenant A").click())
    expect(document.activeElement).toBe(button("changeEmployee"))

    await act(async () => button("changeEmployee").click())
    expect(document.activeElement).toBe(field("evidence-employee-search"))
  })
})
