// @vitest-environment jsdom
/**
 * The «Products and presentations» screen (/mtm/products), as a manager uses
 * it. Owner, 2026-10-15: «этот раздел не очень понятен… нужно подтянуть
 * интуитивность и интерактивность». The new look was shown to him as a
 * picture first («Да, делай»).
 *
 * What is asked here is what the screen sends and says, through the requests
 * it makes — a tick is saved at once, a file is checked before it is sent, a
 * group says what it lacks.
 */
import { readFileSync } from "node:fs"
import { act, createElement, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmProductCatalog } from "@/components/mtm/product-catalog"

vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- a Link prop, not an attribute of <a>
  return { default: ({ href, children, prefetch, ...rest }: { href: string; prefetch?: boolean; children?: unknown }) => h("a", { href, ...rest }, children as never) }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const T = ru.mtmProductCatalog

const AGENTS = [
  { id: "a1", name: "Agent One", role: "AGENT", status: "ACTIVE" },
  { id: "a2", name: "Agent Two", role: "AGENT", status: "ACTIVE" },
  { id: "a3", name: "Agent Three", role: "AGENT", status: "ACTIVE" },
  { id: "m1", name: "Manager One", role: "MANAGER", status: "ACTIVE" },
]
const member = (agentId: string, role: "AGENT" | "MANAGER") => ({ agentId, role, agent: AGENTS.find((agent) => agent.id === agentId)! })

type State = { groups: Array<Record<string, unknown>>; products: Array<Record<string, unknown>> }
let state: State
let calls: Array<{ method: string; url: string; body: unknown }>
let putStatus = 200
let groupPostStatus = 201
let putGate: Promise<void> = Promise.resolve()

function fixtures(): State {
  return {
    groups: [
      { id: "gastro", parentId: null, name: "Gastro", description: null, sortOrder: 0, isActive: true, canManage: true, members: [member("m1", "MANAGER"), member("a1", "AGENT")], products: [] },
      { id: "kardio", parentId: null, name: "Kardio", description: null, sortOrder: 1, isActive: true, canManage: false, members: [], products: [] },
    ],
    products: [
      {
        id: "forlaks", groupId: "gastro", name: "Forlaks", description: null, presentationVersion: "3", isActive: true,
        document: { id: "doc-1", fileName: "Forlaks prezentasiya.pdf", mimeType: "application/pdf", sizeBytes: 984_261, deletedAt: null },
        _count: { presentationSessions: 2 },
      },
    ],
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const method = init?.method ?? "GET"
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : undefined
  calls.push({ method, url, body })
  if (method === "GET" && url.startsWith("/api/v1/mtm/product-groups")) return json({ success: true, data: { groups: state.groups } })
  if (method === "GET" && url.startsWith("/api/v1/mtm/products")) return json({ success: true, data: { products: state.products } })
  if (method === "GET" && url.startsWith("/api/v1/mtm/agents")) return json({ success: true, data: { agents: AGENTS } })
  if (method === "PUT" && url.endsWith("/members")) {
    await putGate
    if (putStatus !== 200) return json({ error: "nope" }, putStatus)
    const groupId = url.split("/").at(-2)
    const members = (body as { members: Array<{ agentId: string; role: "AGENT" | "MANAGER" }> }).members
    state.groups = state.groups.map((group) => group.id === groupId ? { ...group, members: members.map((entry) => member(entry.agentId, entry.role)) } : group)
    return json({ success: true })
  }
  if (method === "POST" && url === "/api/v1/mtm/product-groups") {
    if (groupPostStatus !== 201) return json({ error: "A group with this name already exists here", code: "MTM_PRODUCT_GROUP_NAME_TAKEN" }, groupPostStatus)
    const created = { id: "new-group", parentId: (body as { parentId: string | null }).parentId, name: (body as { name: string }).name, description: null, sortOrder: 0, isActive: true, canManage: true, members: [], products: [] }
    state.groups = [...state.groups, created]
    return json({ success: true, data: created }, 201)
  }
  if (method === "POST" && url === "/api/v1/mtm/products/upload") return json({ success: true, data: { document: { id: "doc-new" } } }, 201)
  if (method === "POST" && url === "/api/v1/mtm/products") {
    const sent = body as { groupId: string; name: string; presentationVersion: string | null; documentId: string }
    state.products = [...state.products, {
      id: "new-product", groupId: sent.groupId, name: sent.name, description: null, presentationVersion: sent.presentationVersion, isActive: true,
      document: { id: sent.documentId, fileName: "Omez_2026.pdf", mimeType: "application/pdf", sizeBytes: 2048, deletedAt: null },
      _count: { presentationSessions: 0 },
    }]
    return json({ success: true, data: {} }, 201)
  }
  return json({ error: "unexpected" }, 500)
})

let container: HTMLDivElement
let root: Root

async function flush() {
  for (let i = 0; i < 6; i += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

async function mount() {
  // The screen goes in as the provider's child below; `children` here only satisfies the props type.
  const intl: ComponentProps<typeof NextIntlClientProvider> = { locale: "ru", timeZone: "Asia/Baku", messages: ru, onError: () => {}, children: null }
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(MtmProductCatalog))))
  await flush()
}

const byTestId = (id: string) => {
  const element = container.querySelector(`[data-testid="${id}"]`)
  if (!element) throw new Error(`no [data-testid="${id}"]`)
  return element as HTMLElement
}
const text = () => container.textContent ?? ""
const checkbox = (agentId: string) => byTestId(`mtm-product-agent-${agentId}`).querySelector("input") as HTMLInputElement
const puts = () => calls.filter((call) => call.method === "PUT")

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
  await flush()
}

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function chooseFile(file: File) {
  const input = byTestId("mtm-product-file") as HTMLInputElement
  Object.defineProperty(input, "files", { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })) })
  await flush()
}

beforeEach(() => {
  state = fixtures()
  calls = []
  putStatus = 200
  groupPostStatus = 201
  putGate = Promise.resolve()
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  fetchMock.mockClear()
})

describe("the product catalog screen", () => {
  it("says for every group whether an agent will see it, and lays the chosen one out as three steps", async () => {
    await mount()

    expect(byTestId("mtm-product-group-gastro").textContent).toContain(T.readiness.READY)
    expect(byTestId("mtm-product-group-kardio").textContent).toContain(T.readiness.NO_PRESENTATIONS)
    expect(byTestId("mtm-product-group-readiness").textContent).toContain(T.readiness.READY)
    const presentations = byTestId("mtm-product-step-presentations").textContent ?? ""
    expect(presentations).toContain("Forlaks")
    expect(presentations).toContain("v3")
    expect(presentations).toContain("Показана 2 раза")
    const download = byTestId("mtm-product-forlaks").querySelector("a") as HTMLAnchorElement
    expect(download.getAttribute("href")).toBe("/api/v1/mtm/products/forlaks/presentation")
    expect(byTestId("mtm-product-step-agents").textContent).toContain("1 из 3")
    expect(byTestId("mtm-product-step-visit").textContent).toContain(T.visitReady)
    // The manager is a member, not one of the agents to tick.
    expect(container.querySelector('[data-testid="mtm-product-agent-m1"]')).toBeNull()
  })

  it("saves a tick at once, keeps the group's managers, and has no save button to forget", async () => {
    await mount()

    await click(checkbox("a2"))

    expect(puts()).toEqual([{
      method: "PUT",
      url: "/api/v1/mtm/product-groups/gastro/members",
      body: { members: [{ agentId: "m1", role: "MANAGER" }, { agentId: "a1", role: "AGENT" }, { agentId: "a2", role: "AGENT" }] },
    }])
    expect(byTestId("mtm-product-step-agents").textContent).toContain(T.saved)
    expect(byTestId("mtm-product-step-agents").textContent).toContain("2 из 3")
    expect(container.querySelectorAll("button").length).toBeGreaterThan(0)
    expect(text()).not.toContain("Сохранить агентов")
  })

  it("writes quick ticks one after another, so the last list is the one that stays", async () => {
    await mount()
    let open!: () => void
    putGate = new Promise((resolve) => { open = resolve })

    await click(checkbox("a2"))
    await click(checkbox("a3"))
    await click(checkbox("a1"))
    // The first save is still on its way; nothing else has been sent behind it.
    expect(puts()).toHaveLength(1)

    await act(async () => open())
    await flush()

    expect(puts().map((call) => (call.body as { members: Array<{ agentId: string }> }).members.map((entry) => entry.agentId))).toEqual([
      ["m1", "a1", "a2"],
      ["m1", "a1", "a2", "a3"],
      ["m1", "a2", "a3"],
    ])
    expect(checkbox("a1").checked).toBe(false)
    expect(checkbox("a3").checked).toBe(true)
  })

  it("ticks everybody with one save", async () => {
    await mount()

    await click(byTestId("mtm-product-agents-all"))

    expect(puts()).toHaveLength(1)
    expect((puts()[0].body as { members: Array<{ agentId: string }> }).members.map((entry) => entry.agentId)).toEqual(["m1", "a1", "a2", "a3"])
  })

  it("shows what the server holds when a tick could not be saved", async () => {
    await mount()
    putStatus = 500

    await click(checkbox("a2"))

    expect(byTestId("mtm-product-step-agents").textContent).toContain(T.saveFailedAgents)
    expect(checkbox("a2").checked).toBe(false)
  })

  it("refuses a file that is not a deck before sending it, and offers the file's name for a deck", async () => {
    await mount()

    await chooseFile(new File(["x"], "photo.jpg", { type: "image/jpeg" }))
    expect(text()).toContain(T.fileWrongType)
    expect(calls.some((call) => call.url === "/api/v1/mtm/products/upload")).toBe(false)

    await chooseFile(new File(["%PDF"], "Omez_2026.pdf", { type: "application/pdf" }))
    const name = byTestId("mtm-product-draft-name") as HTMLInputElement
    expect(name.value).toBe("Omez 2026")
    await type(name, "Omez")
    await click(byTestId("mtm-product-draft-upload"))

    const upload = calls.find((call) => call.url === "/api/v1/mtm/products/upload")
    expect(upload?.method).toBe("POST")
    expect((upload?.body as { title: string }).title).toBe("Omez")
    expect(calls.find((call) => call.method === "POST" && call.url === "/api/v1/mtm/products")?.body).toEqual({
      groupId: "gastro", name: "Omez", presentationVersion: null, documentId: "doc-new",
    })
    expect(text()).toContain("Презентация «Omez» добавлена")
    expect(byTestId("mtm-product-step-presentations").textContent).toContain("Omez")
  })

  it("creates a subgroup from the chosen group, and says so when the name is taken", async () => {
    await mount()

    await click(byTestId("mtm-product-subgroup-new"))
    const form = byTestId("mtm-product-group-form")
    expect((form.querySelector("select") as HTMLSelectElement).value).toBe("gastro")
    groupPostStatus = 409
    await type(byTestId("mtm-product-group-name") as HTMLInputElement, "Kids")
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    await flush()
    expect(text()).toContain(T.groupNameTaken)

    groupPostStatus = 201
    await act(async () => { byTestId("mtm-product-group-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
    await flush()

    expect(calls.filter((call) => call.method === "POST" && call.url === "/api/v1/mtm/product-groups").at(-1)?.body).toEqual({ name: "Kids", parentId: "gastro" })
    // The new group is the one on screen, and it is a subgroup of «Gastro».
    expect(container.querySelector("h2")?.textContent).toBe("Kids")
    expect(byTestId("mtm-product-group-new-group").getAttribute("style")).toContain("padding-left: 30px")
    // The agents of «Gastro» get it already: ticked there, shown here.
    expect(byTestId("mtm-product-agent-a1").textContent).toContain("Получает через «Gastro»")
    expect(checkbox("a1").disabled).toBe(true)
  })

  it("lets a group the user does not manage be read, not changed", async () => {
    await mount()

    await click(byTestId("mtm-product-group-kardio"))

    expect(container.querySelector('[data-testid="mtm-product-dropzone"]')).toBeNull()
    expect(container.querySelector('[data-testid="mtm-product-subgroup-new"]')).toBeNull()
    expect(checkbox("a2").disabled).toBe(true)
    expect(byTestId("mtm-product-step-presentations").textContent).toContain(T.readOnlyHint)
  })
})
