// @vitest-environment jsdom
/**
 * «Удалить агента» on the agents page.
 *
 * Prod, 2026-10-06, owner's screenshot: the dialog answered «Invalid
 * `prisma.mtmAgent.deleteMany()` invocation: Foreign key constraint violated on
 * the constraint: `workforce_employee_team_memberships_agent_fkey`». Nobody
 * could be deleted at all, and the reason was a constraint's name.
 *
 * His decision: an employee without work history is deleted; one with history
 * is not — and the refusal becomes the offer to make them inactive. Whether the
 * server deletes, refuses or keeps the history is proved on a real Postgres in
 * mtm-contact-categories-postgres.test.ts; here the real page and the real
 * dialogs are driven over a stand-in for those three answers.
 */
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"
import MtmAgentsPage from "@/app/(dashboard)/mtm/agents/page"

// A module-level session object: a fresh one per render would re-fire the page's effect for ever.
const session = vi.hoisted(() => ({ data: { user: { organizationId: "org-1", role: "admin" } } }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/mtm/agents",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children?: ReactNode; href: string; [key: string]: unknown }) =>
    createElement("a", { href, ...props }, children),
}))
vi.mock("next-auth/react", () => ({ useSession: () => session }))
vi.mock("@/hooks/use-mtm-org-settings", () => ({ useMtmFeature: () => ({ enabled: true, ready: true }) }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/mtm/agent-form", () => ({ MtmAgentForm: () => null }))
// The card's «…» menu is a Radix popover, which jsdom cannot open; its items are what matter here.
vi.mock("@/components/ui/dropdown-menu", () => {
  const pass = ({ children }: { children?: ReactNode }) => createElement("div", null, children)
  return {
    DropdownMenu: pass,
    DropdownMenuTrigger: pass,
    DropdownMenuContent: pass,
    DropdownMenuItem: ({ children, onSelect }: { children?: ReactNode; onSelect?: () => void }) =>
      createElement("button", { type: "button", "data-menu-item": "", onClick: () => onSelect?.() }, children),
  }
})

const IntlProvider = NextIntlClientProvider as FunctionComponent<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Agent = { id: string; name: string; role: string; status: string; clients: number; lastSeenAt: null }
type Call = { method: string; url: string; body: Record<string, unknown> | null }

let agents: Agent[] = []
let calls: Call[] = []
/** How the server answers a DELETE for each employee. */
let deletion: Record<string, "deleted" | "has-history" | "broken"> = {}
let root: Root | null = null

function stubServer() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null
    calls.push({ method, url, body })
    const id = url.split("?")[0].split("/").pop() ?? ""
    if (method === "DELETE") {
      if (deletion[id] === "has-history") {
        return new Response(JSON.stringify({ error: "This employee has work history and cannot be permanently deleted. Deactivate them instead.", code: "MTM_AGENT_HAS_HISTORY", data: { kinds: ["MtmVisit.agentId"] } }), { status: 409 })
      }
      if (deletion[id] === "broken") {
        return new Response(JSON.stringify({ error: "Invalid `prisma.mtmAgent.deleteMany()` invocation: Foreign key constraint violated" }), { status: 500 })
      }
      agents = agents.filter((agent) => agent.id !== id)
      return new Response(JSON.stringify({ success: true }))
    }
    if (method === "PUT") {
      agents = agents.map((agent) => agent.id === id ? { ...agent, status: String(body?.status) } : agent)
      return new Response(JSON.stringify({ success: true, data: {} }))
    }
    return new Response(JSON.stringify({ success: true, data: { agents, total: agents.length, page: 1, limit: 200 } }))
  }))
}

function words<T>(locale: string, namespace: string): T {
  return (JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Record<string, unknown>)[namespace] as T
}

async function settle(ms = 0) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

async function until(check: () => boolean, what: string) {
  for (let attempt = 0; attempt < 300 && !check(); attempt += 1) await settle(10)
  if (!check()) throw new Error(`timed out waiting for: ${what}`)
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click")
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })) })
}

const cards = () => Array.from(document.querySelectorAll<HTMLElement>("[data-testid='mtm-agent-card']"))
const card = (name: string) => cards().find((item) => item.textContent?.includes(name))
const button = (name: string) => Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.trim() === name)

async function openPage(locale = "ru") {
  agents = [
    { id: "agent-anar", name: "Anar Məmmədov", role: "AGENT", status: "ACTIVE", clients: 42, lastSeenAt: null },
    { id: "agent-trial", name: "Sınaq Agenti", role: "AGENT", status: "ACTIVE", clients: 0, lastSeenAt: null },
  ]
  stubServer()
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as AbstractIntlMessages
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root?.render(createElement(IntlProvider, { locale, messages }, createElement(MtmAgentsPage))) })
  await until(() => cards().length === 2, "both employees")
}

/** The card's «…» menu ends with «delete». */
async function askToDelete(name: string) {
  const items = card(name)?.querySelectorAll("[data-menu-item]")
  await click(items?.[items.length - 1])
  await until(() => Boolean(button(words<{ delete: string }>("ru", "common").delete)), "the confirmation")
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  calls = []
  deletion = {}
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("agents page: deleting an employee", () => {
  it("deletes an employee who has no work history, and says beforehand whom that works for", async () => {
    await openPage()
    const page = words<{ deleteConfirm: string }>("ru", "mtmAgents")
    await askToDelete("Sınaq Agenti")

    expect(document.body.textContent).toContain(page.deleteConfirm.replace("{name}", "Sınaq Agenti"))
    await click(button(words<{ delete: string }>("ru", "common").delete))

    await until(() => cards().length === 1, "the list without the deleted employee")
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.url)).toEqual(["/api/v1/mtm/agents/agent-trial"])
    expect(card("Anar Məmmədov")).toBeDefined()
  })

  it("turns the refusal for an employee with history into the offer to make them inactive", async () => {
    await openPage()
    deletion["agent-anar"] = "has-history"
    const page = words<{ deleteKeptTitle: string; deleteKeptBody: string; deleteKeptAction: string }>("ru", "mtmAgents")
    await askToDelete("Anar Məmmədov")
    await click(button(words<{ delete: string }>("ru", "common").delete))

    await until(() => Boolean(button(page.deleteKeptAction)), "the offer")
    const text = document.body.textContent ?? ""
    expect(text).toContain(page.deleteKeptTitle)
    expect(text).toContain(page.deleteKeptBody.replace("{name}", "Anar Məmmədov"))
    // The server's own English sentence is for logs, not for the manager.
    expect(text).not.toContain("permanently deleted")

    await click(button(page.deleteKeptAction))
    await until(() => calls.some((call) => call.method === "PUT"), "the deactivation")
    expect(calls.find((call) => call.method === "PUT")).toMatchObject({ url: "/api/v1/mtm/agents/agent-anar", body: { status: "INACTIVE" } })
    // Nothing was deleted, and the employee is still on the page.
    expect(cards()).toHaveLength(2)
  })

  it("never shows the database's own words when the server fails", async () => {
    await openPage()
    deletion["agent-anar"] = "broken"
    await askToDelete("Anar Məmmədov")
    await click(button(words<{ delete: string }>("ru", "common").delete))

    await until(() => Boolean(document.querySelector("[role='alert']")), "the failure message")
    const alert = document.querySelector("[role='alert']")?.textContent ?? ""
    expect(alert).toBe(words<{ generic: string }>("ru", "mtmApiErrors").generic)
    expect(document.body.textContent).not.toMatch(/prisma|constraint/i)
  })

  it.each(["en", "ru", "az"])("has the %s words for both dialogs", (locale) => {
    const page = words<Record<string, string>>(locale, "mtmAgents")
    for (const key of ["deleteConfirm", "deleteKeptTitle", "deleteKeptBody", "deleteKeptAlreadyInactive", "deleteKeptAction", "deleteKeptClose"]) {
      expect([key, Boolean(page[key]?.trim())]).toEqual([key, true])
    }
  })
})
