// @vitest-environment jsdom
import { act, createElement, type AnchorHTMLAttributes, type ComponentType, type ComponentProps, type PropsWithChildren } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import messages from "../../messages/ru.json"

const session = vi.hoisted(() => ({ current: { user: { id: "user-a", organizationId: "org-a" } } as { user: { id: string; organizationId: string } } | null }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: session.current }) }))
vi.mock("next/link", () => ({ default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => createElement("a", props, children) }))
import { TaskMeetingNotice } from "@/components/tasks/task-meeting-notice"

// React.createElement supplies the required child as its third argument.
// Retain all other provider prop types while modeling that call shape.
const IntlFixtureProvider = NextIntlClientProvider as ComponentType<PropsWithChildren<Omit<ComponentProps<typeof NextIntlClientProvider>, "children">>>

let root: Root, container: HTMLDivElement
const request = vi.fn<typeof fetch>()
const response = (data: unknown, status = 200) => Response.json(status === 200 ? { success: true, data } : { error: "Denied" }, { status })
async function render(blocked = false, taskId = "task-a") {
  await act(async () => root.render(createElement(IntlFixtureProvider, {
    locale: "ru", messages, timeZone: "Asia/Baku",
  }, createElement(TaskMeetingNotice, { taskId, blocked }))))
}
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  session.current = { user: { id: "user-a", organizationId: "org-a" } }
  request.mockReset()
  vi.stubGlobal("fetch", request)
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

it("offers a keyboard-focusable link to the authorized meeting", async () => {
  request.mockResolvedValue(response({ bookingId: "booking-a" }))
  await render()
  await vi.waitFor(() => expect(container.querySelector("a")?.getAttribute("href")).toBe("/meetings?booking=booking-a"))
  const link = container.querySelector("a")!
  expect(link.textContent).toBe(messages.booking.taskOpenMeeting)
  link.focus(); expect(document.activeElement).toBe(link)
  expect(request.mock.calls[0][1]).toMatchObject({ cache: "no-store", headers: { "x-organization-id": "org-a" } })
})

it("shows an explanation without a booking identity when access is denied", async () => {
  request.mockResolvedValue(response(null, 403))
  await render(true)
  await vi.waitFor(() => expect(container.textContent).toContain(messages.booking.taskManagedAccessHint))
  expect(container.querySelector("a")).toBeNull()
  expect(container.querySelectorAll("button")).toHaveLength(0)
})

it("hides an old user's link while the next user's request is still pending", async () => {
  request.mockResolvedValueOnce(response({ bookingId: "private-a" }))
  await render()
  await vi.waitFor(() => expect(container.querySelector("a")).not.toBeNull())
  request.mockImplementationOnce(() => new Promise(() => {}))
  session.current = { user: { id: "user-b", organizationId: "org-a" } }
  await render()
  expect(container.querySelector("a")).toBeNull()
  expect(container.innerHTML).not.toContain("private-a")
})

it("does not choose an arbitrary meeting for ambiguous historical links", async () => {
  request.mockResolvedValue(response({ bookingId: null }))
  await render()
  await vi.waitFor(() => expect(container.querySelector("a")?.getAttribute("href")).toBe("/meetings"))
  expect(container.querySelector("a")?.textContent).toBe(messages.booking.taskOpenMeetings)
})

it("rechecks a link after a previously ordinary task receives a managed-task conflict", async () => {
  request.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response({ bookingId: "new-link" }))
  await render()
  expect(container.textContent).toBe("")
  await render(true)
  await vi.waitFor(() => expect(container.querySelector("a")?.getAttribute("href")).toBe("/meetings?booking=new-link"))
  expect(request).toHaveBeenCalledTimes(2)
})

it("recovers a failed lookup without reloading the task or sending a mutation", async () => {
  request.mockResolvedValueOnce(response(null, 503)).mockResolvedValueOnce(response({ bookingId: "recovered" }))
  await render(true)
  await vi.waitFor(() => expect(container.querySelector("button")).not.toBeNull())
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click())
  await vi.waitFor(() => expect(container.querySelector("a")?.getAttribute("href")).toBe("/meetings?booking=recovered"))
  expect(request.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true)
})

it("adds no warning to an ordinary task and sends no lookup without a session", async () => {
  request.mockResolvedValue(response(null))
  await render()
  expect(container.textContent).toBe("")
  request.mockClear(); session.current = null
  await render(true)
  expect(request).not.toHaveBeenCalled()
  expect(container.querySelector("a")).toBeNull()
})
