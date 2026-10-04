// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkforceExceptionReport } from "@/components/workforce/workforce-exception-report"

const auth = vi.hoisted(() => ({
  status: "authenticated",
  user: { id: "report-reader-a", organizationId: "report-tenant-a" },
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: auth.user }, status: auth.status }) }))
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children?: ReactNode; href: string }) => createElement("a", { href, ...props }, children) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const IntlProvider = NextIntlClientProvider as FunctionComponent<Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }>
const messages = JSON.parse(readFileSync("messages/en.json", "utf8"))

function response(cases: number) {
  return new Response(JSON.stringify({ success: true, data: {
    timezone: "UTC", start: "2026-10-01", end: "2026-10-03", dateBasis: "CASE_RECORDED_AT",
    report: { summary: { cases, employees: 1, open: cases, awaitingEmployeeResponse: 0, hrReview: 0, resolved: 0, dataIntegrityReview: 0, employeeResponsesReceived: 0 }, byType: [] },
  } }), { status: 200, headers: { "Content-Type": "application/json" } })
}
let container: HTMLDivElement
let root: Root
let pending: Array<{ resolve: (value: Response) => void; signal: AbortSignal }>
let fetchMock: ReturnType<typeof vi.fn>
function render() {
  root.render(createElement(IntlProvider, { locale: "en", messages, timeZone: "UTC" }, createElement(WorkforceExceptionReport)))
}
beforeEach(() => {
  auth.status = "authenticated"
  auth.user = { id: "report-reader-a", organizationId: "report-tenant-a" }
  pending = []
  fetchMock = vi.fn((_url: string, options: { signal: AbortSignal }) => new Promise<Response>(resolve => pending.push({ resolve, signal: options.signal })))
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("report results stay bound to the current authenticated request", () => {
  it.each(["organization", "reader"])("hides old aggregates immediately when the %s changes", async change => {
    await act(async () => render())
    await act(async () => pending[0].resolve(response(731)))
    expect(container.textContent).toContain("731")
    auth.user = change === "organization"
      ? { id: "report-reader-a", organizationId: "report-tenant-b" }
      : { id: "report-reader-b", organizationId: "report-tenant-a" }
    await act(async () => render())
    expect(container.textContent).not.toContain("731")
    expect(container.textContent).toContain(messages.workforceExceptionReport.loading)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => pending[1].resolve(response(42)))
    expect(container.textContent).toContain("42")
    expect(container.textContent).not.toContain("731")
  })

  it("discards a response that completes after its request was aborted", async () => {
    await act(async () => render())
    auth.user = { id: "report-reader-b", organizationId: "report-tenant-b" }
    await act(async () => render())
    expect(pending[0].signal.aborted).toBe(true)
    await act(async () => pending[1].resolve(response(42)))
    await act(async () => pending[0].resolve(response(731)))
    expect(container.textContent).toContain("42")
    expect(container.textContent).not.toContain("731")
  })

  it("clears aggregates and makes no report request while the session is loading", async () => {
    await act(async () => render())
    await act(async () => pending[0].resolve(response(731)))
    auth.status = "loading"
    await act(async () => render())
    expect(container.textContent).not.toContain("731")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(["loading", "unauthenticated"])("requires a new result after %s and reauthentication as the same reader", async interim => {
    await act(async () => render())
    await act(async () => pending[0].resolve(response(731)))
    expect(container.textContent).toContain("731")
    auth.status = interim
    await act(async () => render())
    expect(container.textContent).not.toContain("731")
    auth.status = "authenticated"
    await act(async () => render())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain("731")
    expect(container.textContent).toContain(messages.workforceExceptionReport.loading)
    await act(async () => pending[1].resolve(new Response(JSON.stringify({ code: "WORKFORCE_GRANULAR_ACCESS_REQUIRED" }), { status: 403 })))
    expect(container.textContent).toContain(messages.workforceExceptionReport.adminOnly)
    expect(container.textContent).not.toContain("731")
  })
})
