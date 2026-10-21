// @vitest-environment jsdom
/**
 * The «Products and presentations» screen (/mtm/products), as a manager uses
 * it. Owner, 2026-10-15: «этот раздел не очень понятен… нужно подтянуть
 * интуитивность и интерактивность». Owner, 2026-10-21: «нет удаления
 * презентации и ещё нет выбора презентации… я хочу выбрать несколько
 * презентаций и указать, для какого агента будут видны… и нет сохранения».
 * Both looks were shown to him as a picture first.
 *
 * What is asked here is what the screen sends and says, through the requests
 * it makes — nothing leaves before «Save», «Save» sends only what changes, a
 * deletion names the presentation and keeps its showings, a file is checked
 * before it is sent, a group says what it lacks.
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

type ProductRow = Record<string, unknown> & { id: string; groupId: string; viewerAgentIds: string[]; _count: { presentationSessions: number } }
type State = { groups: Array<Record<string, unknown>>; products: ProductRow[]; deletedShowings: Record<string, number> }
let state: State
let calls: Array<{ method: string; url: string; body: unknown }>
let putStatus = 200
let deleteStatus = 200
let groupPostStatus = 201

const deck = (id: string, name: string, viewerAgentIds: string[], showings = 0, groupId = "gastro"): ProductRow => ({
  id, groupId, name, description: null, presentationVersion: id === "forlaks" ? "3" : null, isActive: true,
  document: { id: `doc-${id}`, fileName: `${name}.pdf`, mimeType: "application/pdf", sizeBytes: 984_261, deletedAt: null },
  viewerAgentIds,
  _count: { presentationSessions: showings },
})

function fixtures(): State {
  return {
    groups: [
      { id: "gastro", parentId: null, name: "Gastro", description: null, sortOrder: 0, isActive: true, canManage: true, members: [member("m1", "MANAGER"), member("a1", "AGENT")], products: [] },
      { id: "kardio", parentId: null, name: "Kardio", description: null, sortOrder: 1, isActive: true, canManage: false, members: [], products: [] },
    ],
    products: [
      deck("forlaks", "Forlaks", ["a1", "a2"], 2),
      deck("gastal", "Gastal", ["a2"]),
      deck("mezim", "Mezim", []),
      deck("kardil", "Kardil", ["a3"], 0, "kardio"),
    ],
    deletedShowings: { gastro: 3 },
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  const method = init?.method ?? "GET"
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : undefined
  calls.push({ method, url, body })
  if (method === "GET" && url.startsWith("/api/v1/mtm/product-groups")) return json({ success: true, data: { groups: state.groups } })
  if (method === "GET" && url.startsWith("/api/v1/mtm/products")) return json({ success: true, data: { products: state.products, deletedShowings: state.deletedShowings } })
  if (method === "GET" && url.startsWith("/api/v1/mtm/agents")) return json({ success: true, data: { agents: AGENTS } })
  if (method === "PUT" && url === "/api/v1/mtm/products/viewers") {
    if (putStatus !== 200) return json({ error: "nope" }, putStatus)
    const sent = body as { productIds: string[]; add: string[]; remove: string[] }
    state.products = state.products.map((product) => sent.productIds.includes(product.id)
      ? { ...product, viewerAgentIds: [...product.viewerAgentIds.filter((id) => !sent.remove.includes(id)), ...sent.add.filter((id) => !product.viewerAgentIds.includes(id))] }
      : product)
    return json({ success: true, data: { products: state.products.filter((product) => sent.productIds.includes(product.id)).map((product) => ({ id: product.id, viewerAgentIds: product.viewerAgentIds })) } })
  }
  if (method === "DELETE" && url.startsWith("/api/v1/mtm/products/")) {
    if (deleteStatus !== 200) return json({ error: "Group is outside your scope" }, deleteStatus)
    const id = url.split("/").at(-1)
    state.products = state.products.filter((product) => product.id !== id)
    return json({ success: true, data: { id } })
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
      viewerAgentIds: [],
      _count: { presentationSessions: 0 },
    }]
    return json({ success: true, data: { id: "new-product" } }, 201)
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
const choose = (productId: string) => byTestId(`mtm-product-choose-${productId}`) as HTMLInputElement
const writes = () => calls.filter((call) => call.method !== "GET")
const button = (label: string) => {
  const found = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label)
  if (!found) throw new Error(`no button «${label}»`)
  return found as HTMLButtonElement
}

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
  deleteStatus = 200
  groupPostStatus = 201
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
  it("says for every group what it lacks, and under each presentation who sees it", async () => {
    await mount()

    expect(byTestId("mtm-product-group-gastro").textContent).toContain("1 презентацию никто не видит")
    expect(byTestId("mtm-product-group-kardio").textContent).toContain(T.readiness.READY)
    expect(byTestId("mtm-product-seen-forlaks").textContent).toBe("Видят: Agent One, Agent Two")
    expect(byTestId("mtm-product-seen-mezim").textContent).toBe(T.seenByNobody)
    const presentations = byTestId("mtm-product-step-presentations").textContent ?? ""
    expect(presentations).toContain("v3")
    expect(presentations).toContain("Показана 2 раза")
    const download = byTestId("mtm-product-forlaks").querySelector("a") as HTMLAnchorElement
    expect(download.getAttribute("href")).toBe("/api/v1/mtm/products/forlaks/presentation")
    // Nothing chosen: «Who sees it» tells what each agent sees, and has nothing to tick.
    expect(byTestId("mtm-product-step-agents").textContent).toContain(T.nothingChosen)
    expect(byTestId("mtm-product-agent-a1").textContent).toContain("Видит: Forlaks")
    expect(byTestId("mtm-product-agent-a3").textContent).toContain(T.agentGroupSeesNothing)
    expect(byTestId("mtm-product-agent-a1").querySelector("input")).toBeNull()
    expect(container.querySelector('[data-testid="mtm-product-save-bar"]')).toBeNull()
    // The manager is a member, not one of the agents to tick.
    expect(container.querySelector('[data-testid="mtm-product-agent-m1"]')).toBeNull()
    // The showings of a deleted presentation still count on the visit step: 2 + 3.
    expect(byTestId("mtm-product-step-visit").textContent).toContain("5")
  })

  it("sends nothing before «Save», then gives the ticked agent every chosen presentation", async () => {
    await mount()

    await click(choose("forlaks"))
    await click(choose("gastal"))
    expect(byTestId("mtm-product-chosen").textContent).toBe("Выбрано: 2 презентации — Forlaks, Gastal")
    // Agent One sees Forlaks only: half-ticked, and says which.
    expect(checkbox("a1").indeterminate).toBe(true)
    expect(byTestId("mtm-product-agent-a1").textContent).toContain("Сейчас только Forlaks")
    expect(checkbox("a2").checked).toBe(true)
    expect(button(T.save).disabled).toBe(true)

    await click(checkbox("a1"))
    expect(writes()).toEqual([])
    expect(checkbox("a1").checked).toBe(true)
    expect(byTestId("mtm-product-agent-a1").textContent).toContain("Сейчас только Forlaks → будет видеть все")
    expect(byTestId("mtm-product-save-bar").textContent).toContain("1 изменение не сохранено")

    await click(button(T.save))

    expect(writes()).toEqual([{
      method: "PUT",
      url: "/api/v1/mtm/products/viewers",
      body: { productIds: ["forlaks", "gastal"], add: ["a1"], remove: [] },
    }])
    expect(byTestId("mtm-product-seen-gastal").textContent).toBe("Видят: Agent One, Agent Two")
    expect(byTestId("mtm-product-save-bar").textContent).toContain(T.noChanges)
    expect(text()).toContain("Сохранено: кто видит «Forlaks», «Gastal».")
  })

  it("leaves a half-ticked agent nobody touched as he was, and takes everything from one unticked", async () => {
    await mount()
    await click(choose("forlaks"))
    await click(choose("gastal"))

    await click(checkbox("a2"))
    await click(checkbox("a3"))
    await click(button(T.save))

    // Agent One sees only Forlaks and was not touched: he is in neither list.
    expect(writes().map((call) => call.body)).toEqual([{ productIds: ["forlaks", "gastal"], add: ["a3"], remove: ["a2"] }])
    expect(byTestId("mtm-product-seen-forlaks").textContent).toBe("Видят: Agent One, Agent Three")
  })

  it("puts the ticks back on «Cancel», and a tick back where it was is no change", async () => {
    await mount()
    await click(choose("mezim"))

    await click(checkbox("a1"))
    await click(checkbox("a1"))
    expect(byTestId("mtm-product-save-bar").textContent).toContain(T.noChanges)

    await click(byTestId("mtm-product-agents-all"))
    expect(byTestId("mtm-product-save-bar").textContent).toContain("3 изменения не сохранены")
    await click(byTestId("mtm-product-viewers-discard"))
    expect(checkbox("a1").checked).toBe(false)
    expect(writes()).toEqual([])
  })

  it("keeps the ticks when «Save» fails, and sends them again", async () => {
    await mount()
    await click(choose("mezim"))
    await click(checkbox("a3"))
    putStatus = 500

    await click(button(T.save))
    expect(byTestId("mtm-product-save-bar").textContent).toContain(T.saveFailedViewers)
    expect(checkbox("a3").checked).toBe(true)

    putStatus = 200
    await click(button(T.save))
    expect(writes().map((call) => call.body)).toEqual([
      { productIds: ["mezim"], add: ["a3"], remove: [] },
      { productIds: ["mezim"], add: ["a3"], remove: [] },
    ])
    expect(byTestId("mtm-product-seen-mezim").textContent).toBe("Видят: Agent Three")
  })

  it("asks before another group drops ticks not saved", async () => {
    await mount()
    await click(choose("mezim"))
    await click(checkbox("a3"))

    await click(byTestId("mtm-product-group-kardio"))
    expect(container.querySelector("h2")?.textContent).toBe("Gastro")
    expect(text()).toContain(T.leaveTitle)

    await click(button(T.leaveConfirm))
    expect(container.querySelector("h2")?.textContent).toBe("Kardio")
    expect(writes()).toEqual([])
  })

  it("deletes a presentation only after a question that names it, and keeps its showings counted", async () => {
    await mount()

    await click(byTestId("mtm-product-delete-forlaks"))
    expect(text()).toContain("Удалить «Forlaks»?")
    expect(text()).toContain("2 показа остаются в истории визитов")
    expect(writes()).toEqual([])

    deleteStatus = 403
    await click(button(T.deleteConfirm))
    expect(text()).toContain(T.deleteFailed)
    expect(container.querySelector('[data-testid="mtm-product-forlaks"]')).not.toBeNull()

    deleteStatus = 200
    await click(button(T.deleteConfirm))
    expect(writes().map((call) => `${call.method} ${call.url}`)).toEqual([
      "DELETE /api/v1/mtm/products/forlaks",
      "DELETE /api/v1/mtm/products/forlaks",
    ])
    expect(container.querySelector('[data-testid="mtm-product-forlaks"]')).toBeNull()
    expect(text()).toContain("Презентация «Forlaks» удалена. Её показы остались в истории визитов.")
    // 3 earlier deleted + Forlaks's 2.
    expect(byTestId("mtm-product-step-visit").textContent).toContain("5")
  })

  it("refuses a file that is not a deck before sending it, and chooses the new deck for «Who sees it»", async () => {
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
    expect(text()).toContain("Презентация «Omez» добавлена и выбрана")
    expect(choose("new-product").checked).toBe(true)
    expect(byTestId("mtm-product-chosen").textContent).toBe("Выбрано: 1 презентация — Omez")
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
    // It hands nobody anything by itself: who sees is chosen on its presentations.
    expect(byTestId("mtm-product-group-readiness").textContent).toContain(T.readiness.NO_PRESENTATIONS)
  })

  it("lets a group the user does not manage be read, not changed", async () => {
    await mount()

    await click(byTestId("mtm-product-group-kardio"))

    expect(container.querySelector('[data-testid="mtm-product-dropzone"]')).toBeNull()
    expect(container.querySelector('[data-testid="mtm-product-subgroup-new"]')).toBeNull()
    expect(container.querySelector('[data-testid="mtm-product-choose-kardil"]')).toBeNull()
    expect(container.querySelector('[data-testid="mtm-product-delete-kardil"]')).toBeNull()
    expect(byTestId("mtm-product-agent-a3").textContent).toContain("Видит: Kardil")
    expect(byTestId("mtm-product-step-presentations").textContent).toContain(T.readOnlyHint)
  })
})
