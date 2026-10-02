// @vitest-environment jsdom
/**
 * Client categories and their own fields, end to end.
 *
 * A tenant's administrator opens MTM settings, adds «Xəstə sayı» (number of
 * patients) to doctors and a category of their own, and presses Save. The
 * next time anyone opens «Yeni müştəri» the field is there.
 *
 * Both screens are rendered for real, and their requests are answered by the
 * real route handlers over one in-memory dictionary table — so the check
 * covers what the editor sends, what the server stores, and what the contact
 * form makes of it, rather than the shape of any single call.
 */
import { act, createElement } from "react"
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
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()
  const { default: messages } = await import("../../messages/az.json")
  // One translator per namespace, as next-intl gives: the screens key their
  // loading effects on `t`, and a fresh function every render would refetch
  // for ever.
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

import { ContactCategorySettings } from "@/app/(dashboard)/mtm/settings/contact-category-settings"
import { MtmContactCreateDialog } from "@/components/mtm/contact-create-dialog"
import { GET as GET_CATEGORIES, PUT as PUT_CATEGORIES } from "@/app/api/v1/mtm/contact-categories/route"
import { GET as GET_DICTIONARIES } from "@/app/api/v1/mtm/contact-dictionaries/route"
import { requireAuth } from "@/lib/api-auth"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { prisma } from "@/lib/prisma"

type DictionaryRow = Record<string, unknown> & { id: string; status: string; version: number }

let dictionaries: DictionaryRow[] = []
let usage: Array<{ type: string; _count: { _all: number } }> = []
let container: HTMLDivElement
let root: Root

async function settle() {
  for (let turn = 0; turn < 6; turn += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  }
}

async function render(element: ReturnType<typeof createElement>) {
  await act(async () => { root.render(element) })
  await settle()
}

async function type(input: Element | null | undefined, value: string) {
  if (!(input instanceof HTMLInputElement)) throw new Error("input not found")
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function choose(select: Element | null | undefined, value: string) {
  if (!(select instanceof HTMLSelectElement)) throw new Error("select not found")
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(select, value)
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

async function press(scope: ParentNode, label: string) {
  const button = [...scope.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`button «${label}» not found`)
  await act(async () => { button.click() })
  await settle()
}

const categoryCards = () => [...container.querySelectorAll<HTMLElement>("[data-testid=mtm-contact-category]")]
const fieldRows = (card: HTMLElement) => [...card.querySelectorAll<HTMLElement>("[data-testid=mtm-contact-category-field]")]
const categoryNames = () => categoryCards().map((card) => card.querySelector<HTMLInputElement>("input")!.value)

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  dictionaries = []
  usage = []
  vi.mocked(requireAuth).mockResolvedValue({
    orgId: "org-1",
    userId: "admin-user",
    role: "admin",
    email: "admin@example.com",
    name: "Admin",
  } as never)
  vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: null, role: "ADMIN", scopedAgentIds: null } as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmAuditLog.create).mockResolvedValue({ id: "audit-1" } as never)
  vi.mocked(prisma.mtmContactDictionaryAssignment.groupBy).mockResolvedValue([] as never)
  vi.mocked(prisma.mtmContact.groupBy).mockImplementation((async () => usage) as never)

  // One in-memory table behind every dictionary query the two screens make.
  vi.mocked(prisma.mtmContactDictionary.findFirst).mockImplementation((async (args: { where: { status?: string }; orderBy?: unknown }) => {
    const rows = dictionaries.filter((row) => !args.where.status || row.status === args.where.status)
    return [...rows].sort((left, right) => right.version - left.version)[0] ?? null
  }) as never)
  vi.mocked(prisma.mtmContactDictionary.findMany).mockImplementation((async (args: { where: { status?: string } }) => (
    dictionaries.filter((row) => !args.where.status || row.status === args.where.status)
  )) as never)
  vi.mocked(prisma.mtmContactDictionary.updateMany).mockImplementation((async (args: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
    const rows = dictionaries.filter((row) => row.id === args.where.id && row.status === args.where.status)
    rows.forEach((row) => Object.assign(row, args.data))
    return { count: rows.length }
  }) as never)
  vi.mocked(prisma.mtmContactDictionary.create).mockImplementation((async (args: { data: Record<string, unknown> }) => {
    const row = { id: `dictionary-${dictionaries.length + 1}`, retiredAt: null, sourceReference: null, ...args.data } as DictionaryRow
    dictionaries.push(row)
    return row
  }) as never)

  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost:3000")
    const request = new NextRequest(url, init as never)
    if (url.pathname === "/api/v1/mtm/contact-categories") {
      return init?.method === "PUT" ? PUT_CATEGORIES(request) : GET_CATEGORIES(request)
    }
    if (url.pathname === "/api/v1/mtm/contact-dictionaries") return GET_DICTIONARIES(request)
    if (url.pathname === "/api/v1/mtm/organizations") {
      return Response.json({ success: true, data: { organizations: [] } })
    }
    throw new Error(`unexpected request: ${url.pathname}`)
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

describe("MTM settings: client categories and their fields", () => {
  it("starts a tenant that configured nothing from the three built-in types", async () => {
    await render(createElement(ContactCategorySettings))
    expect(categoryNames()).toEqual(["Həkim", "Əczaçı", "Digər müştəri"])
    expect(container.textContent).toContain("Dəyişiklik yoxdur")
  })

  it("adds a patient-count field to doctors and a category of the tenant's own, and the new-client form shows them", async () => {
    await render(createElement(ContactCategorySettings))

    const doctor = categoryCards()[0]
    await press(doctor, "Sahə əlavə et")
    const field = fieldRows(categoryCards()[0])[0]
    await type(field.querySelector("input:not([type=checkbox])"), "Xəstə sayı")
    await choose(field.querySelector("select"), "NUMBER")

    await press(container, "Kateqoriya əlavə et")
    await type(categoryCards()[3].querySelector("input"), "Tibb bacısı")

    expect(container.textContent).toContain("Saxlanılmamış dəyişikliklər var")
    await press(container, "Kateqoriyaları saxla")

    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.success).toHaveBeenCalledWith("Kateqoriyalar saxlanıldı")
    expect(dictionaries).toHaveLength(1)
    expect(dictionaries[0]).toMatchObject({ kind: "CLIENT_TYPE", status: "ACTIVE", version: 1 })
    expect(dictionaries[0].entries).toEqual([
      {
        code: "DOCTOR",
        order: 1,
        labels: { ru: "Врач", az: "Həkim", en: "Doctor" },
        fields: [{
          key: "xeste_sayi",
          order: 1,
          type: "NUMBER",
          required: false,
          labels: { ru: "Xəstə sayı", az: "Xəstə sayı", en: "Xəstə sayı" },
        }],
      },
      { code: "PHARMACIST", order: 2, labels: { ru: "Фармацевт", az: "Əczaçı", en: "Pharmacist" }, fields: [] },
      { code: "OTHER", order: 3, labels: { ru: "Другой клиент", az: "Digər müştəri", en: "Other client" }, fields: [] },
      { code: "TIBB_BACISI", order: 4, labels: { ru: "Tibb bacısı", az: "Tibb bacısı", en: "Tibb bacısı" }, fields: [] },
    ])

    // The editor is back on what is stored, and the saved field's kind is fixed.
    expect(categoryNames()).toEqual(["Həkim", "Əczaçı", "Digər müştəri", "Tibb bacısı"])
    expect(container.textContent).toContain("Dəyişiklik yoxdur")
    expect(fieldRows(categoryCards()[0])[0].querySelector("select")).toBeNull()
    expect(fieldRows(categoryCards()[0])[0].querySelector("[data-testid=mtm-contact-category-field-type]")?.textContent).toBe("Rəqəm")

    // The form an agent's manager opens next.
    await act(async () => { root.unmount() })
    root = createRoot(container)
    await render(createElement(MtmContactCreateDialog, { open: true, onOpenChange: () => undefined, onCreated: () => undefined }))

    const categorySelect = document.querySelector<HTMLSelectElement>("#contact-create-type")!
    expect([...categorySelect.options].map((option) => option.textContent)).toEqual(["Həkim", "Əczaçı", "Digər müştəri", "Tibb bacısı"])
    const patients = document.querySelector<HTMLInputElement>("#contact-create-category-xeste_sayi")
    expect(patients?.type).toBe("number")
    expect(document.querySelector("label[for=contact-create-category-xeste_sayi]")?.textContent).toBe("Xəstə sayı")

    // Another category has no such field.
    await choose(categorySelect, "TIBB_BACISI")
    expect(document.querySelector("#contact-create-category-xeste_sayi")).toBeNull()
  })

  it("keeps a second save as a new version on top of the first, renaming without losing the field", async () => {
    await render(createElement(ContactCategorySettings))
    await press(categoryCards()[0], "Sahə əlavə et")
    await type(fieldRows(categoryCards()[0])[0].querySelector("input:not([type=checkbox])"), "Xəstə sayı")
    await press(container, "Kateqoriyaları saxla")

    await type(fieldRows(categoryCards()[0])[0].querySelector("input:not([type=checkbox])"), "Pasiyent sayı")
    await press(container, "Kateqoriyaları saxla")

    expect(dictionaries.map((row) => [row.version, row.status])).toEqual([[1, "RETIRED"], [2, "ACTIVE"]])
    const fields = (dictionaries[1].entries as Array<{ fields: Array<{ key: string; labels: { az: string } }> }>)[0].fields
    // Values are stored under the key, so the key must survive the rename.
    expect(fields).toEqual([expect.objectContaining({ key: "xeste_sayi", labels: expect.objectContaining({ az: "Pasiyent sayı" }) })])
  })

  it("explains instead of deleting when a category still has clients", async () => {
    usage = [{ type: "PHARMACIST", _count: { _all: 7 } }]
    await render(createElement(ContactCategorySettings))
    expect(categoryCards()[1].textContent).toContain("7 müştəri")

    await press(categoryCards()[1], "Sil")
    expect(toast.error).toHaveBeenCalledWith("«Əczaçı» kateqoriyasında 7 müştəri var. Əvvəlcə onları başqa kateqoriyaya keçirin.")
    expect(categoryNames()).toEqual(["Həkim", "Əczaçı", "Digər müştəri"])

    // An empty one goes without questions, and nothing is written until Save.
    await press(categoryCards()[2], "Sil")
    expect(categoryNames()).toEqual(["Həkim", "Əczaçı"])
    expect(dictionaries).toHaveLength(0)
  })

  it("does not save a field without a name and says which category it is in", async () => {
    await render(createElement(ContactCategorySettings))
    await press(categoryCards()[0], "Sahə əlavə et")
    await press(container, "Kateqoriyaları saxla")
    expect(toast.error).toHaveBeenCalledWith("«Həkim» kateqoriyasındakı sahənin adını yazın.")
    expect(dictionaries).toHaveLength(0)
  })

  it("shows nothing to someone who cannot configure the module", async () => {
    vi.mocked(resolveMtmRouteActor).mockResolvedValue({ agentId: "agent-1", role: "MANAGER", scopedAgentIds: new Set(["agent-1"]) } as never)
    await render(createElement(ContactCategorySettings))
    expect(container.querySelector("[data-testid=mtm-contact-category-settings]")).toBeNull()
  })
})
