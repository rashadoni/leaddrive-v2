// @vitest-environment jsdom
/**
 * Choosing the workplace of a new MTM contact (owner's screenshot, 2026-10-02).
 *
 * The form had a search box and, under it, a separate «Təşkilat» select. The
 * select held only the first 50 organizations by name; the search box did not
 * choose anything, it silently refilled the select — and only on Enter or on
 * the magnifier. Nothing on screen said so, so the box read as a duplicate of
 * the select. It also hid a trap: with an organization chosen, a search whose
 * answer did not contain it left the select on its placeholder while the form
 * still held the old id, and «Müştəri yarat» saved the contact at a workplace
 * the screen was not showing.
 *
 * Both dialogs are rendered for real — the real Dialog, the real picker, the
 * real message files — and every check reads the rendered form or the request
 * it sends. The organizations endpoint is answered by a stand-in that filters
 * the way the route does (`contains` over name, code, address, city, district).
 */
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"
import { MtmContactCreateDialog } from "@/components/mtm/contact-create-dialog"
import { MtmContactWorkplaceDialog, type EditableMtmWorkplace } from "@/components/mtm/contact-workplace-dialog"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const IntlProvider = NextIntlClientProvider as FunctionComponent<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Organization = {
  id: string
  code: string | null
  name: string
  objectType: string
  address: string | null
  city: string | null
  district: string | null
}

type PickerMessages = {
  placeholder: string
  change: string
  empty: string
  error: string
  retry: string
  more: string
  objectTypes: Record<string, string>
}

const ONCOLOGY: Organization = { id: "org-onc", code: "C-001", name: "Milli Onkologiya Mərkəzi", objectType: "CLINIC", address: "Həsənbəy Zərdabi küçəsi 79B", city: "Bakı", district: "Yasamal" }
const ZEYTUN: Organization = { id: "org-zey", code: "P-777", name: "Zeytun Aptek 12", objectType: "PHARMACY", address: "Nizami küçəsi 5", city: "Gəncə", district: null }
// Sixty pharmacies sort before both of them, as a real tenant's catalog does:
// neither is among the first rows, so each is reachable only by typing.
const CATALOG: Organization[] = [
  ...Array.from({ length: 60 }, (_, index) => ({
    id: `org-${index}`,
    code: null,
    name: `Aptek ${String(index + 1).padStart(2, "0")}`,
    objectType: "PHARMACY",
    address: null,
    city: "Sumqayıt",
    district: null,
  })),
  ONCOLOGY,
  ZEYTUN,
]

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

let root: Root | null = null
let calls: Call[] = []
/** Search text → how long the stand-in holds that answer back, and whether it fails. */
let delays: Record<string, number> = {}
let failing = false

function messagesFor(locale: string): AbstractIntlMessages {
  return JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as AbstractIntlMessages
}

function stubServer() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : null })
    if (url.startsWith("/api/v1/mtm/organizations?")) {
      const params = new URL(url, "http://localhost").searchParams
      const search = (params.get("search") ?? "").toLowerCase()
      const limit = Number(params.get("limit"))
      if (delays[search]) await new Promise((resolve) => setTimeout(resolve, delays[search]))
      if (failing) return new Response(JSON.stringify({ success: false, error: "boom" }), { status: 500 })
      const found = CATALOG
        .filter((organization) => [organization.name, organization.code, organization.address, organization.city, organization.district]
          .some((field) => field?.toLowerCase().includes(search)))
        .sort((left, right) => left.name.localeCompare(right.name))
      return new Response(JSON.stringify({ success: true, data: { organizations: found.slice(0, limit), total: found.length } }))
    }
    if (url === "/api/v1/mtm/contact-dictionaries") return new Response(JSON.stringify({ success: false }), { status: 404 })
    return new Response(JSON.stringify({ success: true, data: {} }))
  }))
}

async function mount(locale: string, element: ReactNode) {
  const missing: string[] = []
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(IntlProvider, { locale, messages: messagesFor(locale), onError: (error) => { missing.push(error.message) } }, element))
  })
  await settle()
  return { container, missing }
}

async function settle(ms = 0) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
}

async function until(check: () => boolean, what: string) {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) await settle(10)
  if (!check()) throw new Error(`timed out waiting for: ${what}`)
}

function searchField(container: HTMLElement): HTMLInputElement {
  const field = container.querySelector<HTMLInputElement>("input[role='combobox']")
  if (!field) throw new Error("the organization search field is not on screen")
  return field
}

async function type(field: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    field.focus()
    setValue?.call(field, text)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function fill(container: HTMLElement, id: string, text: string) {
  const field = container.querySelector<HTMLInputElement>(`#${id}`)
  if (!field) throw new Error(`no field #${id}`)
  await type(field, text)
}

async function press(field: HTMLInputElement, key: string) {
  await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })) })
}

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("nothing to click")
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })) })
}

function options(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-testid='mtm-organization-option']")).map((option) => option.textContent ?? "")
}

function chosen(container: HTMLElement): string | null {
  return container.querySelector("[data-testid='mtm-organization-selected']")?.textContent ?? null
}

function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === name)
}

function organizationSearches(): string[] {
  return calls.filter((call) => call.url.startsWith("/api/v1/mtm/organizations?"))
    .map((call) => new URL(call.url, "http://localhost").searchParams.get("search") ?? "")
}

function contactPosts(): Call[] {
  return calls.filter((call) => call.url === "/api/v1/mtm/contacts" && call.method === "POST")
}

async function openCreateDialog(locale = "az") {
  stubServer()
  const view = await mount(locale, createElement(MtmContactCreateDialog, { open: true, onOpenChange: () => undefined, onCreated: () => undefined }))
  await fill(view.container, "contact-create-last-name", "Əliyev")
  await fill(view.container, "contact-create-first-name", "Rauf")
  return view
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = null
  calls = []
  delays = {}
  failing = false
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("MTM organization picker in the new contact form", () => {
  it("is one field: there is no separate organization select and no search button to press", async () => {
    const { container } = await openCreateDialog()

    expect(container.querySelectorAll("input[role='combobox']")).toHaveLength(1)
    expect(container.querySelector("#contact-create-workplace-select")).toBeNull()
    // Only the category list is a <select> now.
    expect(Array.from(container.querySelectorAll("select")).map((select) => select.id)).toEqual(["contact-create-type"])
  })

  it("finds an organization beyond the first rows as the user types, without Enter", async () => {
    const { container } = await openCreateDialog()
    const picker = messagesFor("az").mtmOrganizationPicker as unknown as PickerMessages

    await type(searchField(container), "")
    await until(() => options(container).length > 0, "the first organizations")
    expect(options(container).some((text) => text.includes(ONCOLOGY.name))).toBe(false)
    // The list says it is partial instead of passing for the whole catalog.
    expect(container.textContent).toContain(picker.more.replace("{shown}", "8").replace("{total}", String(CATALOG.length)))

    await type(searchField(container), "onkolog")
    await until(() => options(container).length === 1, "the single match for «onkolog»")

    expect(organizationSearches()).toContain("onkolog")
    expect(options(container)[0]).toContain(ONCOLOGY.name)
    expect(options(container)[0]).toContain(`${picker.objectTypes.CLINIC} · C-001 · Bakı, Yasamal · Həsənbəy Zərdabi küçəsi 79B`)
  })

  it("matches by address and by code, not only by name", async () => {
    const { container } = await openCreateDialog()

    await type(searchField(container), "Nizami")
    await until(() => options(container).length === 1, "the match by address")
    expect(options(container)[0]).toContain(ZEYTUN.name)

    await type(searchField(container), "c-001")
    await until(() => options(container).length === 1 && options(container)[0].includes(ONCOLOGY.name), "the match by code")
  })

  it("saves the organization the user pressed", async () => {
    const { container } = await openCreateDialog()
    const create = messagesFor("az").mtmContactCreate as unknown as { save: string }

    await type(searchField(container), "onkolog")
    await until(() => options(container).length === 1, "the match")
    await click(container.querySelector("[data-testid='mtm-organization-option']"))

    expect(chosen(container)).toContain(ONCOLOGY.name)
    expect(container.querySelector("input[role='combobox']")).toBeNull()

    await click(buttonNamed(container, create.save))
    await until(() => contactPosts().length === 1, "the contact to be posted")
    expect((contactPosts()[0].body as { primaryWorkplace: { customerId: string } }).primaryWorkplace.customerId).toBe(ONCOLOGY.id)
  })

  it("never saves an organization the screen is no longer showing", async () => {
    const { container } = await openCreateDialog()
    const create = messagesFor("az").mtmContactCreate as unknown as { save: string; workplaceRequired: string }
    const picker = messagesFor("az").mtmOrganizationPicker as unknown as PickerMessages

    await type(searchField(container), "onkolog")
    await until(() => options(container).length === 1, "the match")
    await click(container.querySelector("[data-testid='mtm-organization-option']"))
    expect(chosen(container)).toContain(ONCOLOGY.name)

    // The old form's trap: search again for something else and save without choosing.
    await click(buttonNamed(container, picker.change))
    expect(chosen(container)).toBeNull()
    await type(searchField(container), "zeytun")
    await until(() => options(container).length === 1 && options(container)[0].includes(ZEYTUN.name), "the second search")

    await click(buttonNamed(container, create.save))
    await settle(50)

    expect(contactPosts()).toEqual([])
    expect(container.querySelector("[role='alert']")?.textContent).toContain(create.workplaceRequired)
  })

  it("keeps the matches of the latest text when an earlier answer arrives late", async () => {
    const { container } = await openCreateDialog()
    delays = { zey: 600 }

    await type(searchField(container), "zey")
    await until(() => organizationSearches().includes("zey"), "the first request to leave")
    await type(searchField(container), "onkolog")
    await until(() => options(container).length === 1 && options(container)[0].includes(ONCOLOGY.name), "the match for the latest text")

    await settle(700)
    expect(options(container)).toHaveLength(1)
    expect(options(container)[0]).toContain(ONCOLOGY.name)
  })

  it("chooses the highlighted match on Enter instead of submitting the form", async () => {
    const { container } = await openCreateDialog()

    await type(searchField(container), "apt")
    await until(() => options(container).length === 8, "eight pharmacies")
    await press(searchField(container), "ArrowDown")
    const field = searchField(container)
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    await act(async () => { field.dispatchEvent(enter) })

    expect(enter.defaultPrevented).toBe(true)
    expect(chosen(container)).toContain("Aptek 02")
    expect(contactPosts()).toEqual([])
  })

  it("says so when nothing matches and when the search fails, and retries", async () => {
    const { container } = await openCreateDialog()
    const picker = messagesFor("az").mtmOrganizationPicker as unknown as PickerMessages

    await type(searchField(container), "qqqq")
    await until(() => (container.textContent ?? "").includes(picker.empty), "the nothing-found line")
    expect(options(container)).toEqual([])

    failing = true
    await type(searchField(container), "onkolog")
    await until(() => (container.textContent ?? "").includes(picker.error), "the failure line")

    failing = false
    await click(buttonNamed(container, picker.retry))
    await until(() => options(container).length === 1, "the retried search")
    expect(options(container)[0]).toContain(ONCOLOGY.name)
  })

  it.each(["en", "ru", "az"])("shows %s words, not message keys", async (locale) => {
    const { container, missing } = await openCreateDialog(locale)

    await type(searchField(container), "onkolog")
    await until(() => options(container).length === 1, "the match")
    const open = container.textContent ?? ""
    await click(container.querySelector("[data-testid='mtm-organization-option']"))
    await click(buttonNamed(container, (messagesFor(locale).mtmOrganizationPicker as unknown as PickerMessages).change))
    await type(searchField(container), "qqqq")
    await until(() => options(container).length === 0 && !(container.textContent ?? "").includes(ONCOLOGY.name), "the empty answer")

    for (const text of [open, container.textContent ?? ""]) {
      expect(text).not.toContain("mtmOrganizationPicker.")
      expect(text).not.toContain("mtmContactCreate.")
    }
    expect(missing).toEqual([])
  })
})

describe("MTM organization picker in the workplace dialog", () => {
  const WORKPLACE: EditableMtmWorkplace = {
    id: "wp-1",
    jobTitle: "Onkoloq",
    department: null,
    room: null,
    phone: null,
    isPrimary: true,
    startedOn: null,
    endedOn: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
    customer: { id: ONCOLOGY.id, code: ONCOLOGY.code, name: ONCOLOGY.name, address: ONCOLOGY.address, city: ONCOLOGY.city, district: ONCOLOGY.district },
  }

  async function openWorkplaceDialog(workplace: EditableMtmWorkplace | null, locale = "az") {
    stubServer()
    return mount(locale, createElement(MtmContactWorkplaceDialog, {
      open: true,
      onOpenChange: () => undefined,
      contactId: "contact-1",
      contactUpdatedAt: "2026-10-01T10:00:00.000Z",
      workplace,
      canManage: true,
      canRequestChanges: false,
      orgId: "tenant-1",
      onSaved: () => undefined,
    }))
  }

  it("shows the current organization as chosen and saves a replacement picked by typing", async () => {
    const { container } = await openWorkplaceDialog(WORKPLACE)
    const dialog = messagesFor("az").mtmContactWorkplace as unknown as { save: string }
    const picker = messagesFor("az").mtmOrganizationPicker as unknown as PickerMessages

    expect(chosen(container)).toContain(ONCOLOGY.name)
    // Nothing is fetched until the user actually looks for another organization.
    expect(organizationSearches()).toEqual([])

    await click(buttonNamed(container, picker.change))
    await type(searchField(container), "zeytun")
    await until(() => options(container).length === 1, "the match")
    await click(container.querySelector("[data-testid='mtm-organization-option']"))
    await click(buttonNamed(container, dialog.save))
    await until(() => calls.some((call) => call.method === "PUT"), "the workplace to be saved")

    const search = calls.find((call) => call.url.startsWith("/api/v1/mtm/organizations?"))
    expect(search?.headers["x-organization-id"]).toBe("tenant-1")
    const saved = calls.find((call) => call.method === "PUT")
    expect(saved?.url).toBe("/api/v1/mtm/contacts/contact-1/workplaces")
    expect((saved?.body as { customerId: string; id: string }).customerId).toBe(ZEYTUN.id)
    expect((saved?.body as { customerId: string; id: string }).id).toBe("wp-1")
  })

  it.each(["en", "ru", "az"])("refuses to save without an organization, in %s words", async (locale) => {
    const { container, missing } = await openWorkplaceDialog(null, locale)
    const dialog = messagesFor(locale).mtmContactWorkplace as unknown as { save: string; organizationRequired: string }

    await type(searchField(container), "onkolog")
    await until(() => options(container).length === 1, "the match")
    await click(buttonNamed(container, dialog.save))
    await settle(50)

    expect(calls.filter((call) => call.method !== "GET")).toEqual([])
    expect(container.querySelector("[role='alert']")?.textContent).toContain(dialog.organizationRequired)
    expect(container.textContent).not.toContain("mtmOrganizationPicker.")
    expect(container.textContent).not.toContain("mtmContactWorkplace.")
    expect(missing).toEqual([])
  })
})
