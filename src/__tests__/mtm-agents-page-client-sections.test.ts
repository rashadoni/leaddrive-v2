// @vitest-environment jsdom
/**
 * The agents page as the way into an employee's own section (owner,
 * 2026-10-02). Opening an employee used to lead to their GPS history, and
 * nothing on the card said how many clients they hold or led to them.
 *
 * The real page with the real message files; the list endpoint is a stand-in.
 */
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"
import MtmAgentsPage from "@/app/(dashboard)/mtm/agents/page"

const feature = vi.hoisted(() => ({ enabled: true }))
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
vi.mock("@/hooks/use-mtm-org-settings", () => ({ useMtmFeature: () => ({ enabled: feature.enabled, ready: true }) }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/mtm/agent-form", () => ({ MtmAgentForm: () => null }))
vi.mock("@/components/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null, ConfirmDialog: () => null }))

const IntlProvider = NextIntlClientProvider as FunctionComponent<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const AGENTS = [
  { id: "agent-anar", name: "Anar Məmmədov", role: "AGENT", status: "ACTIVE", phone: "+994550001122", clients: 42, lastSeenAt: null },
  { id: "agent-leyla", name: "Leyla Həsənova", role: "AGENT", status: "ACTIVE", phone: null, clients: null, lastSeenAt: null },
]

let root: Root | null = null

async function openPage(locale = "az") {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: { agents: AGENTS, total: AGENTS.length, page: 1, limit: 200 } }))))
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as AbstractIntlMessages
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root?.render(createElement(IntlProvider, { locale, messages }, createElement(MtmAgentsPage))) })
  for (let attempt = 0; attempt < 200 && !container.querySelector("[data-testid='mtm-agent-card']"); attempt += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  return { container, words: (messages.mtmAgents as unknown as { clients: string; clientsCount: string }) }
}

function card(container: HTMLElement, name: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>("[data-testid='mtm-agent-card']")).find((item) => item.textContent?.includes(name))
  if (!found) throw new Error(`no card for ${name}`)
  return found
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  feature.enabled = true
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("agents page: the way into an employee's section", () => {
  it.each(["en", "ru", "az"])("leads from the card to the employee's clients, in %s words", async (locale) => {
    const { container, words } = await openPage(locale)
    const anar = card(container, "Anar Məmmədov")

    const link = anar.querySelector<HTMLAnchorElement>("[data-testid='mtm-agent-clients-link']")
    expect(link?.getAttribute("href")).toBe("/mtm/agents/agent-anar")
    expect(link?.textContent).toBe(words.clientsCount.replace("{count}", "42"))
    // Opening the employee by name leads to the same section.
    expect(anar.querySelector("[data-testid='mtm-agent-open']")?.getAttribute("href")).toBe("/mtm/agents/agent-anar")
    expect(container.textContent).not.toContain("mtmAgents.")
  })

  it("shows the word without a number when the count is unknown, never a made-up zero", async () => {
    const { container, words } = await openPage()

    expect(card(container, "Leyla Həsənova").querySelector("[data-testid='mtm-agent-clients-link']")?.textContent).toBe(words.clients)
  })

  it("keeps the old way — GPS history — where the organization switched field contacts off", async () => {
    feature.enabled = false
    const { container } = await openPage()
    const anar = card(container, "Anar Məmmədov")

    expect(anar.querySelector("[data-testid='mtm-agent-clients-link']")).toBeNull()
    expect(anar.querySelector("[data-testid='mtm-agent-open']")?.getAttribute("href")).toBe("/mtm/map?mode=history&agentId=agent-anar")
  })
})
