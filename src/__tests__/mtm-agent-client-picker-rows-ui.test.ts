// @vitest-environment jsdom
/**
 * «Əlavə müştəri təyin et» on an agent's page, as the owner reads it (2026-10-20,
 * in front of a list of institutions with «11/11»: «тут не указаны категории…
 * нужно, чтобы в списке было указано название клиента, а потом место, где он
 * находится»). The real picker behind the real list, in Azerbaijani; only the
 * network is stubbed, and it answers with `buildAgentClientPicker` itself.
 * Fictional doctors and institutions only.
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

const az = JSON.parse(readFileSync("messages/az.json", "utf8")) as Record<string, Record<string, string>>
vi.mock("next-intl", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl")
  const translators = new Map<string, unknown>()
  return {
    useTranslations: (namespace: string) => {
      if (!translators.has(namespace)) translators.set(namespace, actual.createTranslator({ locale: "az", messages: az, namespace: namespace as never }))
      return translators.get(namespace)
    },
  }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }))

import { MtmAgentAttachByPlace } from "@/components/mtm/agent-attach-by-place"
import { buildAgentClientPicker, type PickerContactRow, type PickerInstitution } from "@/lib/mtm/agent-client-picker"

const AGENT = "agent-fictional"
const place = (id: string, name: string, extra: Partial<PickerInstitution> = {}): PickerInstitution => ({
  id, name, address: null, city: "Bakı", locality: null, district: null, administrativeDistrict: null, cityDistrict: null, ...extra,
})
const doctor = (id: string, name: string, institution: PickerInstitution | null, category = "B", agents: PickerContactRow["agents"] = []): PickerContactRow =>
  ({ id, name, specialtyName: "Terapevt", category, institution, agents })

let rows: PickerContactRow[] = []
let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()

const all = (id: string) => [...document.body.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
const byTestId = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)
async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}
async function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click")
  await act(async () => { (element as HTMLElement).click() })
  await flush()
}
async function chooseTerapevt() {
  await click(byTestId("agent-clients-specialty"))
  const option = [...document.body.querySelectorAll('[data-testid="agent-clients-specialty-options"] label')].find(label => label.textContent?.includes("Terapevt"))
  await click(option?.querySelector("button,input"))
}

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => {
    const params = new URL(url, "http://x").searchParams
    const data = buildAgentClientPicker(rows, { specialties: params.getAll("specialty"), cities: params.getAll("city"), districts: params.getAll("district"), classes: params.getAll("class") }, params.get("agentId"), ["A", "B", "C", "VIP"])
    return { ok: true, status: 200, json: async () => ({ success: true, data: { ...data, asOf: "2026-10-20" } }) }
  })
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

async function render() {
  await act(async () => { root.render(createElement(MtmAgentAttachByPlace, { agentId: AGENT, agentName: "Fictional Agent", onAttached: vi.fn(), onForbidden: vi.fn() })) })
  await flush()
}

describe("the agent's «attach» list, one row a doctor", () => {
  it("reads the doctor first — his name, his class, his specialty — and then where he works", async () => {
    const nineteenth = place("p19", "19 saylı Fictional Poliklinika", { district: "Yasamal", address: "Fictional küç. 25" })
    const second = place("p2", "2 saylı Fictional Poliklinika", { address: "Fictional pr. 1" })
    rows = [
      doctor("d1", "Fictional Zeynalova", nineteenth, "VIP", [{ agentId: "other", role: "PRIMARY", name: "Fictional Colleague" }]),
      doctor("d2", "Fictional Abbasova", second, "A"),
      doctor("d3", "Fictional Məmmədli", null),
    ]
    await render()
    await chooseTerapevt()

    // Column by column: the doctor and his specialty, his class, where he works, whose he is.
    const text = all("agent-clients-doctor").map(row => [...row.children].slice(1).map(cell => cell.textContent).join(" | "))
    expect(text).toEqual([
      // «2 saylı» before «19 saylı»; the doctor without an institution last.
      "Fictional AbbasovaTerapevt | A | 2 saylı Fictional PoliklinikaBakı · Fictional pr. 1 | ",
      "Fictional ZeynalovaTerapevt | VIP | 19 saylı Fictional PoliklinikaYasamal · Fictional küç. 25 | artıq: Fictional Colleague",
      "Fictional MəmmədliTerapevt | B | Müəssisəsiz | ",
    ])
    expect(byTestId("agent-clients-head")?.textContent).toBe("HəkimKateqoriyaİş yeriAgentlər")
    expect(byTestId("agent-clients-summary")?.textContent).toContain("3 həkim tapıldı, 2 müəssisədə")
    // Every doctor is ticked and seen: no institution to open first.
    expect(all("agent-clients-doctor-tick").every(tick => tick.getAttribute("aria-checked") === "true")).toBe(true)
    expect(byTestId("mtm-agent-attach-submit")?.textContent).toBe("Seçilənləri təyin et (3)")
  })

  it("takes a doctor out by his name as well as by his box", async () => {
    rows = [doctor("d1", "Fictional Aliyeva", place("c1", "Fictional Clinic")), doctor("d2", "Fictional Babayev", place("c1", "Fictional Clinic"))]
    await render()
    await chooseTerapevt()

    const babayev = all("agent-clients-doctor").find(row => row.textContent?.includes("Fictional Babayev"))!
    await click([...babayev.querySelectorAll("span")].find(span => span.textContent === "Fictional Babayev"))
    expect(babayev.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("false")
    expect(byTestId("mtm-agent-attach-submit")?.textContent).toBe("Seçilənləri təyin et (1)")
  })

  it("draws a hundred rows at a time, and still assigns every doctor found", async () => {
    const clinic = place("c1", "Fictional Clinic")
    rows = Array.from({ length: 250 }, (_, index) => doctor(`d${index}`, `Fictional Doctor ${String(index).padStart(3, "0")}`, clinic))
    await render()
    await chooseTerapevt()

    expect(all("agent-clients-doctor")).toHaveLength(100)
    expect(byTestId("agent-clients-show-more")?.textContent).toBe("Daha 100 həkim göstər · 150 qalıb")
    // The rows not drawn yet are ticked like the rest.
    expect(byTestId("mtm-agent-attach-submit")?.textContent).toBe("Seçilənləri təyin et (250)")

    await click(byTestId("agent-clients-show-more"))
    expect(all("agent-clients-doctor")).toHaveLength(200)
    expect(byTestId("agent-clients-show-more")?.textContent).toBe("Qalan 50 həkimi göstər")
    await click(byTestId("agent-clients-show-more"))
    expect(all("agent-clients-doctor")).toHaveLength(250)
    expect(byTestId("agent-clients-show-more")).toBeNull()
  })
})

describe("the first step, before anything is chosen", () => {
  // Owner, 2026-10-21, in front of «1. İxtisas: Hamısı» over an empty frame:
  // «сейчас вообще ничего не загружается».
  const clinic = place("c1", "Fictional Clinic")
  const withSpecialty = (row: PickerContactRow, specialtyName: string | null): PickerContactRow => ({ ...row, specialtyName })
  const company = () => [
    withSpecialty(doctor("t1", "Fictional Terapevt One", clinic), "Terapevt"),
    withSpecialty(doctor("t2", "Fictional Terapevt Two", clinic), "Terapevt"),
    withSpecialty(doctor("g1", "Fictional Qastro", clinic), "Qastroenteroloq"),
    withSpecialty(doctor("n1", "Fictional Nobody Knows", null, "B", [{ agentId: AGENT, role: "PRIMARY", name: "Fictional Agent" }]), null),
  ]
  const choices = () => all("agent-clients-start-choice").map(button => button.textContent)

  it("offers every specialty with its count, and «Hamısı», instead of an empty frame", async () => {
    rows = company()
    await render()

    expect(byTestId("agent-clients-specialty")?.textContent).toBe("Seçin")
    expect(choices()).toEqual(["Terapevt2 həkim", "Qastroenteroloq1 həkim", "Göstərilməyib1 həkim", "Hamısı4 həkim"])
    // Still nobody listed and nobody ticked: a card opened and closed takes no one along.
    expect(all("agent-clients-doctor")).toHaveLength(0)
    expect(byTestId("mtm-agent-attach-submit")?.hasAttribute("disabled")).toBe(true)
  })

  it("lists the doctors of a specialty after one press on it", async () => {
    rows = company()
    await render()
    await click(all("agent-clients-start-choice").find(button => button.textContent?.startsWith("Terapevt")))

    expect(byTestId("agent-clients-specialty")?.textContent).toBe("Terapevt")
    expect(all("agent-clients-doctor").map(row => row.querySelector('[role="checkbox"]')?.getAttribute("aria-label"))).toEqual(["Fictional Terapevt One", "Fictional Terapevt Two"])
    expect(byTestId("mtm-agent-attach-submit")?.textContent).toBe("Seçilənləri təyin et (2)")
  })

  it("lists everyone on «Hamısı» — the button, and the same word in the step's own list", async () => {
    rows = company()
    await render()
    await click(all("agent-clients-start-choice").find(button => button.textContent?.startsWith("Hamısı")))

    expect(byTestId("agent-clients-specialty")?.textContent).toBe("Hamısı")
    expect(all("agent-clients-doctor")).toHaveLength(4)
    // The agent's own doctor is listed ticked and is not sent again.
    expect(byTestId("mtm-agent-attach-submit")?.textContent).toBe("Seçilənləri təyin et (3)")
    // Every specialty went to the server as «no filter», never as a list of values.
    const asked = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), "http://x").searchParams
    expect(asked.getAll("specialty")).toEqual([])

    await act(async () => { root.unmount() })
    root = createRoot(container)
    await render()
    await click(byTestId("agent-clients-specialty"))
    await click([...document.body.querySelectorAll('[data-testid="agent-clients-specialty-options"] button')].find(button => button.textContent?.startsWith("Hamısı")))
    expect(all("agent-clients-doctor")).toHaveLength(4)
    expect(byTestId("agent-clients-specialty")?.textContent).toBe("Hamısı")
  })
})

describe("the fourth step, the class", () => {
  // Owner, 2026-10-21: the class «как дополнительный столбец… в разделе, где добавляем к агентам» and in the filter.
  it("narrows the ticked doctors to the class chosen, and shows each doctor's class in its column", async () => {
    const clinic = place("c1", "Fictional Clinic")
    rows = [
      doctor("d1", "Fictional Aliyeva", clinic, "VIP"),
      doctor("d2", "Fictional Babayev", clinic, "B"),
      doctor("d3", "Fictional Cavadova", clinic, "B"),
    ]
    await render()
    // Nothing to choose before the specialty: the step waits like the place.
    expect(byTestId("agent-clients-class")?.hasAttribute("disabled")).toBe(true)
    await chooseTerapevt()
    expect(all("agent-clients-doctor-class").map(cell => cell.textContent)).toEqual(["VIP", "B", "B"])

    await click(byTestId("agent-clients-class"))
    const options = () => [...document.body.querySelectorAll('[data-testid="agent-clients-class-options"] label')]
    // The company's classes in its order, «0» included.
    expect(options().map(option => option.textContent)).toEqual(["A0", "B2", "C0", "VIP1"])
    await click(options().find(option => option.textContent?.startsWith("VIP"))?.querySelector("button,input"))

    expect(all("agent-clients-doctor").map(row => row.querySelector('[role="checkbox"]')?.getAttribute("aria-label"))).toEqual(["Fictional Aliyeva"])
    expect(byTestId("mtm-agent-attach-submit")?.textContent).toBe("Seçilənləri təyin et (1)")
    expect(new URL(String(fetchMock.mock.calls.at(-1)?.[0]), "http://x").searchParams.getAll("class")).toEqual(["VIP"])
  })
})
