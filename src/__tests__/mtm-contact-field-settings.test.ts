// @vitest-environment jsdom
/**
 * MTM settings → «Карточка клиента»: categories, the fields of the card and
 * the list of specialties, as three tabs of one block.
 *
 * Owner 2026-10-02: «вот список специальностей, продумай так, чтобы была
 * возможность добавления, удаления, и в настройках сделай, чтобы завтра, если
 * буду продавать другому профилю, была возможность отключать ненужные поля» —
 * and, looking at the categories block: «они тут будут отображаться? надо
 * сделать UI часть более юзер френдли».
 *
 * The block is rendered for real; its requests go to the real settings and
 * categories handlers over an in-memory settings table. So «switch a field
 * off and press Save» is checked by what the server then holds.
 */
import { act, createElement, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})
vi.mock("@/lib/mtm/route-permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mtm/route-permissions")>()
  return { ...actual, resolveMtmRouteActor: vi.fn() }
})
vi.mock("@/lib/mtm-audit", () => ({ writeMtmAudit: vi.fn().mockResolvedValue(undefined) }))
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const { default: messages } = await import("../../messages/az.json")
  // One translator per namespace, as next-intl gives: the categories tab keys
  // its loading effect on `t`.
  const translators = new Map<string, unknown>()
  return {
    ...actual,
    useLocale: () => "az",
    useTranslations: (namespace: string) => {
      if (!translators.has(namespace)) {
        translators.set(namespace, actual.createTranslator({ locale: "az", messages: messages as never, namespace: namespace as never }))
      }
      return translators.get(namespace)
    },
  }
})
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

import { ContactCardSettings } from "@/app/(dashboard)/mtm/settings/contact-card-settings"
import { GET as GET_CATEGORIES } from "@/app/api/v1/mtm/contact-categories/route"
import { PUT as PUT_SETTINGS } from "@/app/api/v1/mtm/settings/route"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { getMtmSettings } from "@/lib/mtm-settings"
import { MTM_CONTACT_SPECIALTY_DEFAULTS } from "@/lib/mtm/contact-specialties"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { prisma } from "@/lib/prisma"

const ORG = "org-1"
let container: HTMLDivElement
let root: Root
/** The tenant's stored settings rows. */
let stored: Array<{ key: string; value: unknown }> = []
const storedValue = (key: string) => stored.find((row) => row.key === key)?.value

async function settle() {
  for (let turn = 0; turn < 6; turn += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

/** The settings page around the block: it keeps what the server holds. */
function Page({ initial }: { initial: Record<string, unknown> }) {
  const [loaded, setLoaded] = useState(initial)
  return createElement(ContactCardSettings, {
    requiredFields: loaded.contactRequiredFields,
    hiddenFields: loaded.contactHiddenFields,
    specialties: loaded.contactSpecialties,
    onSaved: (changes) => setLoaded((current) => ({ ...current, ...changes })),
  })
}

async function open() {
  const settings = await getMtmSettings(ORG)
  await act(async () => { root.render(createElement(Page, { initial: settings as unknown as Record<string, unknown> })) })
  await settle()
}

const tab = (id: string) => container.querySelector<HTMLButtonElement>(`[data-testid="mtm-contact-card-tab-${id}"]`)!
const panel = (id: string) => container.querySelector<HTMLElement>(`#mtm-contact-card-panel-${id}`)!
async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error("element not found")
  await act(async () => { element.click() })
  await settle()
}

const row = (field: string) => container.querySelector<HTMLElement>(`[data-field="${field}"]`)!
const toggle = (field: string) => click(row(field).querySelector('[role="switch"]'))
const tickRequired = (field: string) => click(row(field).querySelector('input[type="checkbox"]'))
const save = (which: "fields" | "specialties") => click(container.querySelector(`[data-testid="mtm-contact-${which}-save"]`))

const specialtyNames = () => [...panel("specialties").querySelectorAll("li > span")].map((item) => item.textContent)
const specialtyInput = () => panel("specialties").querySelector<HTMLInputElement>('[data-testid="mtm-contact-specialty-new"]')!
async function addSpecialty(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(specialtyInput(), value)
    specialtyInput().dispatchEvent(new Event("input", { bubbles: true }))
  })
  await click(panel("specialties").querySelector('button[type="submit"]'))
}
/** What Ctrl+V does: the text arrives in the event, lines intact. */
async function pasteSpecialties(text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } })
  await act(async () => { specialtyInput().dispatchEvent(event) })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  stored = []
  vi.mocked(getOrgId).mockResolvedValue(ORG)
  vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "admin-user", role: "admin", email: "admin@example.com", name: "Admin" } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
  vi.mocked(prisma.mtmContactDictionary.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.mtmContactDictionaryAssignment.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmContact.groupBy).mockResolvedValue([] as never)

  // One in-memory table behind every read and write of MTM settings.
  vi.mocked(prisma.mtmSetting.findMany).mockImplementation((async () => stored) as never)
  vi.mocked(prisma.mtmSetting.upsert).mockImplementation((async (args: { create: { key: string; value: unknown } }) => {
    stored = [...stored.filter((item) => item.key !== args.create.key), { key: args.create.key, value: args.create.value }]
    return args.create
  }) as never)

  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost:3000")
    const request = new NextRequest(url, init as never)
    if (url.pathname === "/api/v1/mtm/settings" && init?.method === "PUT") return PUT_SETTINGS(request)
    if (url.pathname === "/api/v1/mtm/contact-categories") return GET_CATEGORIES(request)
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url.pathname}`)
  }))

  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("MTM settings: the client card in one block", () => {
  it("names its three parts in words, and shows doctors' specialties where their fields are", async () => {
    await open()
    expect([...container.querySelectorAll('[role="tab"]')].map((item) => item.textContent)).toEqual([
      "Kateqoriyalar",
      // Four fields are off until a tenant asks for them (see below).
      "Sahələr · 4 gizli",
      "İxtisaslar · 34",
    ])
    expect(panel("categories").hidden).toBe(false)
    expect(panel("fields").hidden).toBe(true)

    // «Həkim» says its specialty comes from the list; the other categories do not.
    const notes = [...container.querySelectorAll('[data-testid="mtm-contact-category-specialty-note"]')]
    expect(notes).toHaveLength(1)
    expect(notes[0].closest('[data-testid="mtm-contact-category"]')?.querySelector("input")?.value).toBe("Həkim")
    expect(notes[0].textContent).toContain("siyahıda 34 ixtisas var")

    await click(notes[0].querySelector("button"))
    expect(panel("specialties").hidden).toBe(false)
    expect(specialtyNames()).toEqual([...MTM_CONTACT_SPECIALTY_DEFAULTS])
  })
})

describe("MTM settings: client fields", () => {
  it("shows a switch per field; the name is always required and has none", async () => {
    await open()
    await click(tab("fields"))
    expect(row("firstName").dataset.state).toBe("locked")
    expect(row("firstName").querySelector('[role="switch"]')).toBeNull()
    expect(row("specialtyName").dataset.state).toBe("shown")
    expect(row("specialtyName").querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true")
    // Coverage is a figure in the list, not something to fill: no «required».
    expect(row("coverage").querySelector('input[type="checkbox"]')).toBeNull()
    expect(container.textContent).toContain("Dəyişiklik yoxdur")
  })

  it("switches fields off and stores it only when «Yadda saxla» is pressed", async () => {
    await open()
    await click(tab("fields"))
    await toggle("specialtyName")
    await toggle("coverage")
    expect(row("specialtyName").dataset.state).toBe("hidden")
    expect(tab("fields").textContent).toContain("Sahələr · 6 gizli")
    expect(panel("fields").textContent).toContain("Yadda saxlanmamış dəyişikliklər var")
    expect(storedValue("contactHiddenFields")).toBeUndefined()

    await save("fields")
    expect(toast.success).toHaveBeenCalledWith("Yadda saxlanıldı")
    expect(storedValue("contactHiddenFields")).toEqual(["specialtyName", "specialtyCode", "coverage", "homePhone", "messengerPhone", "viberPhone"])
    expect((await getMtmSettings(ORG)).contactHiddenFields).toEqual(["specialtyName", "specialtyCode", "coverage", "homePhone", "messengerPhone", "viberPhone"])
    expect(panel("fields").textContent).toContain("Dəyişiklik yoxdur")
    // Doctors no longer have a specialty, so their category stops saying so.
    expect(container.querySelector('[data-testid="mtm-contact-category-specialty-note"]')).toBeNull()

    // And back on.
    await toggle("specialtyName")
    await save("fields")
    expect(storedValue("contactHiddenFields")).toEqual(["specialtyCode", "coverage", "homePhone", "messengerPhone", "viberPhone"])
  })

  it("keeps the specialty code and three spare phones off until a tenant switches them on", async () => {
    // Owner, 2026-10-02, on the client form: «для чего два типа кода… клиент
    // голову возьмёт руками и убежит». The code repeats the specialty next to
    // it; nobody on production had filled the three phones.
    expect((await getMtmSettings(ORG)).contactHiddenFields).toEqual(["specialtyCode", "homePhone", "messengerPhone", "viberPhone"])
    await open()
    await click(tab("fields"))
    expect(row("specialtyCode").dataset.state).toBe("hidden")
    expect(row("specialtyName").dataset.state).toBe("shown")
    expect(row("mobilePhone").dataset.state).toBe("shown")

    // One switch brings the code back, and only the code.
    await toggle("specialtyCode")
    expect(row("specialtyCode").dataset.state).toBe("shown")
    await save("fields")
    expect(storedValue("contactHiddenFields")).toEqual(["homePhone", "messengerPhone", "viberPhone"])
    expect((await getMtmSettings(ORG)).contactHiddenFields).toEqual(["homePhone", "messengerPhone", "viberPhone"])
  })

  it("stops requiring a field when it is switched off", async () => {
    stored = [{ key: "contactRequiredFields", value: ["firstName", "lastName", "mobilePhone"] }]
    await open()
    await click(tab("fields"))
    expect(row("mobilePhone").dataset.state).toBe("required")

    await toggle("mobilePhone")
    expect(row("mobilePhone").querySelector('input[type="checkbox"]')).toBeNull()
    await save("fields")
    expect(storedValue("contactHiddenFields")).toEqual(["specialtyCode", "mobilePhone", "homePhone", "messengerPhone", "viberPhone"])
    expect(storedValue("contactRequiredFields")).toEqual(["firstName", "lastName"])

    await toggle("mobilePhone")
    await tickRequired("mobilePhone")
    await save("fields")
    expect(storedValue("contactHiddenFields")).toEqual(["specialtyCode", "homePhone", "messengerPhone", "viberPhone"])
    expect(storedValue("contactRequiredFields")).toEqual(["firstName", "lastName", "mobilePhone"])
  })

  it("puts the switches back with «Ləğv et», and stores nothing", async () => {
    await open()
    await click(tab("fields"))
    await toggle("email")
    await click([...panel("fields").querySelectorAll("button")].find((button) => button.textContent?.trim() === "Ləğv et"))
    expect(row("email").dataset.state).toBe("shown")
    expect(prisma.mtmSetting.upsert).not.toHaveBeenCalled()
  })

  it("says so when the server refuses the save, and keeps what was changed", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "viewer", role: "viewer" } as never)
    await open()
    await click(tab("fields"))
    await toggle("email")
    await save("fields")
    expect(toast.error).toHaveBeenCalledWith("Bu parametrləri administrator və ya rəhbər dəyişə bilər.")
    expect(row("email").dataset.state).toBe("hidden")
    expect(stored).toEqual([])
  })
})

describe("MTM settings: client specialties", () => {
  it("starts from the owner's list", async () => {
    await open()
    await click(tab("specialties"))
    expect(specialtyNames()).toEqual([...MTM_CONTACT_SPECIALTY_DEFAULTS])
    expect(panel("specialties").textContent).toContain("Cəmi: 34")
  })

  it("adds one, refuses the same one in another case, removes one — and stores the list on save", async () => {
    stored = [{ key: "contactSpecialties", value: ["Pediatr", "Lor"] }]
    await open()
    await click(tab("specialties"))
    await addSpecialty("Onkoloq")
    expect(specialtyNames()).toEqual(["Pediatr", "Lor", "Onkoloq"])

    await addSpecialty("PEDIATR")
    expect(specialtyNames()).toEqual(["Pediatr", "Lor", "Onkoloq"])
    expect(panel("specialties").textContent).toContain("Belə ixtisas artıq siyahıda var.")

    await click([...panel("specialties").querySelectorAll("li button")].find((button) => button.getAttribute("aria-label") === "«Lor» sil"))
    expect(specialtyNames()).toEqual(["Pediatr", "Onkoloq"])
    expect(tab("specialties").textContent).toContain("İxtisaslar · 2")
    expect(storedValue("contactSpecialties")).toEqual(["Pediatr", "Lor"])

    await save("specialties")
    expect(storedValue("contactSpecialties")).toEqual(["Pediatr", "Onkoloq"])
    expect((await getMtmSettings(ORG)).contactSpecialties).toEqual(["Pediatr", "Onkoloq"])
  })

  it("takes a column pasted from Excel as separate specialties", async () => {
    stored = [{ key: "contactSpecialties", value: ["Pediatr"] }]
    await open()
    await click(tab("specialties"))
    // A one-line field would glue the lines into one name; the paste is taken apart instead.
    await pasteSpecialties("Ginekoloq\r\nQastroenteroloq\r\npediatr\r\nProktoloq\r\n")
    expect(specialtyNames()).toEqual(["Pediatr", "Ginekoloq", "Qastroenteroloq", "Proktoloq"])

    // Several typed through commas work the same way.
    await addSpecialty("Uroloq, Nefroloq")
    await save("specialties")
    expect(storedValue("contactSpecialties")).toEqual(["Pediatr", "Ginekoloq", "Qastroenteroloq", "Proktoloq", "Uroloq", "Nefroloq"])
  })

  it("can be emptied: the tenant then types a specialty freely", async () => {
    stored = [{ key: "contactSpecialties", value: ["Pediatr"] }]
    await open()
    await click(tab("specialties"))
    await click(panel("specialties").querySelector("li button"))
    expect(panel("specialties").textContent).toContain("Siyahı boşdur")
    await save("specialties")
    expect(storedValue("contactSpecialties")).toEqual([])
    expect((await getMtmSettings(ORG)).contactSpecialties).toEqual([])
  })

  it("keeps an unsaved edit in one tab while another tab is opened and saved", async () => {
    await open()
    await click(tab("specialties"))
    await addSpecialty("Onkoloq")
    await click(tab("fields"))
    await toggle("gender")
    await save("fields")
    await click(tab("specialties"))
    expect(specialtyNames()).toContain("Onkoloq")
    expect(storedValue("contactSpecialties")).toBeUndefined()
  })
})
