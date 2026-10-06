// @vitest-environment jsdom
/**
 * «Find and assign an existing record» inside the route builder.
 *
 * Until 2026-10-06 choosing a doctor who belongs to another employee
 * TRANSFERRED the doctor: «Назначение „X“ завершится…, а ответственным станет
 * „Y“». The owner's rule since that day: a client may have several employees,
 * and attaching adds one. So the route's employee is attached beside the one
 * the doctor has. An organization is still handed over, with its confirmation.
 *
 * The real panel with the real message files; the catalogue and the
 * assignment endpoint are stand-ins, and the checks read the page and the
 * request. What the server does with `keepOthers` is proved on a real Postgres
 * in mtm-contact-categories-postgres.test.ts.
 */
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"
import { RouteBuilderInlineAssignmentPanel, type RouteBuilderInlineAssignable } from "@/components/mtm/route-builder-inline-assignment-panel"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const IntlProvider = NextIntlClientProvider as FunctionComponent<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ROUTE_AGENT = { id: "agent-leyla", name: "Leyla Həsənova" }
const OTHER = { id: "agent-seymur", name: "Seymur Məmmədov" }
const place = { id: "org-1", name: "Mərkəzi Klinika", address: "Nizami 5", city: "Bakı" } as RouteBuilderInlineAssignable["customer"]

function candidate(subjectType: "CONTACT" | "ORGANIZATION", name: string, owner: typeof OTHER | null): RouteBuilderInlineAssignable {
  return {
    id: `${subjectType.toLowerCase()}-${name}`,
    subjectType,
    kind: subjectType === "CONTACT" ? "DOCTOR" : "ORGANIZATION",
    name,
    code: null,
    specialtyName: subjectType === "CONTACT" ? "Kardioloq" : null,
    currentOwner: owner,
    customer: place,
    contact: subjectType === "CONTACT" ? { id: `contact-${name}`, displayName: name } : null,
  }
}

let root: Root | null = null
let sent: Array<Record<string, unknown>> = []

async function openPanel(items: RouteBuilderInlineAssignable[], onAssigned = vi.fn()) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      sent.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({ success: true, data: {} }))
    }
    void input
    return new Response(JSON.stringify({ success: true, data: { targetAgent: ROUTE_AGENT, items, limited: false } }))
  }))
  const messages = JSON.parse(readFileSync("messages/ru.json", "utf8")) as AbstractIntlMessages
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(IntlProvider, { locale: "ru", messages }, createElement(RouteBuilderInlineAssignmentPanel, {
      open: true, onOpenChange: vi.fn(), agentId: ROUTE_AGENT.id, date: "2026-10-07", direction: "DOCTOR", onAssigned,
    })))
  })
  for (let attempt = 0; attempt < 200 && !container.querySelector("[data-testid='mtm-route-inline-assignment-item']"); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  return { container, onAssigned }
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click")
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
}

const words = () => (JSON.parse(readFileSync("messages/ru.json", "utf8")) as { mtmRoutesPage: Record<string, string> }).mtmRoutesPage
const fill = (template: string, values: Record<string, string>) => Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template)

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  sent = []
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("route builder: a record that already has an employee", () => {
  it("attaches a doctor beside the employee they have, without a transfer and without asking twice", async () => {
    const doctor = candidate("CONTACT", "Rauf Əliyev", OTHER)
    const { container, onAssigned } = await openPanel([doctor])
    const t = words()

    const row = container.querySelector("[data-testid='mtm-route-inline-assignment-item']")
    expect(row?.textContent).toContain(fill(t.inlineAssignmentSharedWith, { agent: OTHER.name }))
    const add = row?.querySelector("[data-testid='mtm-route-inline-assignment-add']")
    expect(add?.textContent).toBe(t.inlineAssignmentShareAction)

    await click(add)

    // No «the assignment of X will end» step: nothing is taken from X.
    expect(container.textContent).not.toContain(fill(t.inlineAssignmentTransferTitle, { name: doctor.name }))
    expect(sent).toEqual([expect.objectContaining({ subjectType: "CONTACT", subjectId: doctor.id, agentId: ROUTE_AGENT.id, keepOthers: true })])
    expect(sent[0]).not.toHaveProperty("role")
    expect(onAssigned).toHaveBeenCalledWith(doctor)
  })

  it("still asks before handing an organization over from another employee", async () => {
    const pharmacy = candidate("ORGANIZATION", "Zeytun Aptek 1", OTHER)
    const { container } = await openPanel([pharmacy])
    const t = words()

    const add = container.querySelector("[data-testid='mtm-route-inline-assignment-add']")
    expect(add?.textContent).toBe(t.inlineAssignmentTransferAction)
    await click(add)

    expect(container.textContent).toContain(fill(t.inlineAssignmentTransferTitle, { name: pharmacy.name }))
    expect(sent).toEqual([])
  })

  it.each(["en", "ru", "az"])("has the %s words for the shared doctor", (locale) => {
    const page = (JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as { mtmRoutesPage: Record<string, string> }).mtmRoutesPage
    expect([Boolean(page.inlineAssignmentSharedWith?.includes("{agent}")), Boolean(page.inlineAssignmentShareAction?.trim())]).toEqual([true, true])
  })
})
