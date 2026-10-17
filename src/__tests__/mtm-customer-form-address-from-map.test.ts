// @vitest-environment jsdom
/**
 * The organization's address is not typed: it comes from the map.
 *
 * Owner, 2026-10-07: «адрес поле убери из заполнений, пусть он добавляется
 * через поиск на карте». A hand-typed address and a pin set on the map were
 * two answers to one question, and they disagreed on the first card he tried.
 *
 * The real form with the Russian copy. The map picker is a stand-in that
 * hands over what the real one would; the network is stubbed.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"

const ru = JSON.parse(readFileSync("messages/ru.json", "utf8")) as Record<string, Record<string, string>>
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string) => ru[namespace]?.[key] ?? key,
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? createElement("div", null, children) : null,
  DialogContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement("h2", null, children),
  DialogFooter: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}))

type Place = { address: string; district: string; city: string; label: string }
type PickerProps = {
  latitude: number | null
  longitude: number | null
  address?: string
  onChange: (lat: number, lng: number) => void
  onAddress?: (place: Place) => void
}
const picker = vi.hoisted(() => ({ props: null as PickerProps | null }))
vi.mock("next/dynamic", () => ({
  default: () => (props: PickerProps) => { picker.props = props; return null },
}))

import { MtmCustomerForm } from "@/components/mtm/customer-form"

const CARD = {
  id: "org-1",
  code: "ORG-1",
  name: "First Clinic",
  category: "B",
  status: "ACTIVE",
  address: "Old street 1",
  city: "Old city",
  district: "",
  latitude: 40.1,
  longitude: 49.1,
}

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()

async function show(initialData?: typeof CARD) {
  await act(async () => {
    root.render(createElement(MtmCustomerForm, { open: true, onOpenChange: () => {}, onSaved: () => {}, initialData }))
  })
}
const addressLine = () => container.querySelector('[data-testid="mtm-customer-form-address"]')?.textContent ?? ""
async function save() {
  await act(async () => {
    container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  picker.props = null
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) })
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("organization form — the address comes from the map", () => {
  it("has no field to type an address into, and shows the one the card has", async () => {
    await show(CARD)

    expect(container.querySelector("#address")).toBeNull()
    expect(addressLine()).toBe("Адрес: Old street 1")
    // The map is asked to take over the address, and starts from what the card says.
    expect(typeof picker.props?.onAddress).toBe("function")
    expect(picker.props?.address).toBe("Old street 1, Old city")
  })

  it("tells a new card where its address will come from", async () => {
    await show()
    expect(addressLine()).toBe("Адрес: появится, когда вы укажете место на карте")
  })

  it("takes the address, the district and the city of the place set on the map, and saves them", async () => {
    await show(CARD)
    await act(async () => {
      picker.props?.onChange(40.399929, 49.805225)
      picker.props?.onAddress?.({ address: "New avenue 79B", district: "New district", city: "New city", label: "New avenue 79B, New district, New city" })
    })

    expect(addressLine()).toBe("Адрес: New avenue 79B")
    expect((container.querySelector("#city") as HTMLInputElement).value).toBe("New city")
    expect((container.querySelector("#district") as HTMLInputElement).value).toBe("New district")

    await save()
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }]
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect([url, init.method]).toEqual(["/api/v1/mtm/customers/org-1", "PUT"])
    expect([body.address, body.district, body.city, body.latitude, body.longitude])
      .toEqual(["New avenue 79B", "New district", "New city", "40.399929", "49.805225"])
  })

  it("keeps the city and the district it has when the map knows only the street", async () => {
    await show(CARD)
    await act(async () => {
      picker.props?.onAddress?.({ address: "Lone street 5", district: "", city: "", label: "Lone street 5" })
    })

    expect(addressLine()).toBe("Адрес: Lone street 5")
    expect((container.querySelector("#city") as HTMLInputElement).value).toBe("Old city")
  })

  it("saves a card whose pin was never touched with the address it had", async () => {
    await show(CARD)
    await save()

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body) as Record<string, unknown>
    expect([body.address, body.city]).toEqual(["Old street 1", "Old city"])
  })
})

// Owner's E2E test, 2026-10-17: the form had no type and every new institution became a «Mağaza» (STORE).
describe("organization form — the institution's type", () => {
  it("asks for the type, offers a clinic first, and sends what was chosen", async () => {
    await show()
    const type = container.querySelector("#objectType") as HTMLSelectElement
    expect(type.value).toBe("CLINIC")
    expect([...type.options].map(option => option.value)).toEqual(["CLINIC", "PHARMACY", "STORE", "OTHER"])
    expect(container.textContent).toContain(ru.mtmCustomers.add)
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(type, "PHARMACY"); type.dispatchEvent(new Event("change", { bubbles: true })) })
    await act(async () => { const name = container.querySelector("#name") as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Aptek 1"); name.dispatchEvent(new Event("input", { bubbles: true })) })
    await save()
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body).objectType).toBe("PHARMACY")
  })

  it("keeps an older record's own type when it is edited", async () => {
    await show({ ...CARD, objectType: "DOCTOR" } as typeof CARD)
    expect((container.querySelector("#objectType") as HTMLSelectElement).value).toBe("DOCTOR")
    await save()
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, { body: string }])[1].body).objectType).toBe("DOCTOR")
  })
})
