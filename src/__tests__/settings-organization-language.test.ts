import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * «Язык общения с клиентами» (Settings → Organization) is the organization's
 * `settings.language`: what the website chat, ticket notices and renewal
 * e-mails use when the customer's own language is unknown. The test drives
 * the real route and then asks the real readers — `organizationLocale`,
 * `loadOrganizationLocale`, `loadCustomerLanguage` — over one in-memory
 * organization row, so a save that does not reach what customers read fails.
 */

type Auth = { orgId: string; userId: string; role: string }
let auth: Auth
const rows = new Map<string, { settings: unknown }>()
const logAudit = vi.fn()

vi.mock("@/lib/with-rls", () => ({
  withRlsSessionAuth: (handler: (req: NextRequest, auth: Auth) => unknown) => (req: NextRequest) => handler(req, auth),
}))

vi.mock("@/lib/prisma", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
  prisma: {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = rows.get(where.id)
        return row ? { settings: structuredClone(row.settings) } : null
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { settings: unknown } }) => {
        rows.set(where.id, { settings: structuredClone(data.settings) })
        return {}
      }),
    },
    contact: {
      findFirst: vi.fn(async () => ({ preferredLanguage: null })),
    },
  },
}))

import { GET, PATCH } from "@/app/api/v1/settings/organization/language/route"
import { PATCH as patchDelivery } from "@/app/api/v1/settings/ai-delivery/route"
import { loadCustomerLanguage, loadOrganizationLocale, organizationLocale } from "@/lib/ticketing/customer-locale"

function patch(body: unknown, path = "/api/v1/settings/organization/language") {
  return new NextRequest(`http://localhost${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

const get = () => new NextRequest("http://localhost/api/v1/settings/organization/language")
const stored = () => rows.get("org-1")!.settings as Record<string, unknown>

beforeEach(() => {
  vi.clearAllMocks()
  auth = { orgId: "org-1", userId: "user-1", role: "admin" }
  rows.clear()
  rows.set("org-1", {
    settings: { language: "ru", telegramBotToken: "bot-secret", timezone: "Asia/Baku", webChat: { enabled: true } },
  })
})

describe("Settings → Organization: customer language", () => {
  it("saving it changes the language customers are written to in, and nothing else", async () => {
    expect(organizationLocale(stored())).toBe("ru")

    const res = await PATCH(patch({ language: "az" }))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ language: "az", canEdit: true })

    expect(organizationLocale(stored())).toBe("az")
    expect(await loadOrganizationLocale("org-1")).toBe("az")
    // A customer without a language of their own follows the organization.
    expect((await loadCustomerLanguage({ organizationId: "org-1", contactId: "contact-1" })).locale).toBe("az")
    // The rest of the settings row survives the save.
    expect(stored()).toMatchObject({ telegramBotToken: "bot-secret", timezone: "Asia/Baku", webChat: { enabled: true } })

    await PATCH(patch({ language: "en" }))
    expect(await loadOrganizationLocale("org-1")).toBe("en")
    expect((await (await GET(get())).json()).data.language).toBe("en")

    expect(logAudit).toHaveBeenLastCalledWith(
      "org-1", "organization_language_updated", "organization", "org-1", "Customer language",
      expect.objectContaining({ userId: "user-1", oldValue: { language: "az" }, newValue: { language: "en" } }),
    )
  })

  it("shows what customers actually get: a legacy settings.locale counts, and a save overrides it", async () => {
    rows.set("org-1", { settings: { locale: "az" } })
    expect((await (await GET(get())).json()).data.language).toBe("az")

    await PATCH(patch({ language: "ru" }))
    expect(await loadOrganizationLocale("org-1")).toBe("ru")
  })

  it("only an administrator changes it; everyone else reads it without the button", async () => {
    auth = { ...auth, role: "manager" }

    const read = await (await GET(get())).json()
    expect(read.data).toEqual({ language: "ru", canEdit: false })

    const res = await PATCH(patch({ language: "az" }))
    expect(res.status).toBe(403)
    expect(await loadOrganizationLocale("org-1")).toBe("ru")
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("refuses a language the product does not speak", async () => {
    for (const body of [{ language: "de" }, { language: "" }, {}, { language: "az", extra: 1 }]) {
      const res = await PATCH(patch(body))
      expect(res.status).toBe(400)
    }
    expect(stored().language).toBe("ru")
  })
})

describe("AI delivery card no longer owns the language", () => {
  it("refuses language and saves the three fields the card sends without touching it", async () => {
    const withLanguage = await patchDelivery(patch({ language: "az" }, "/api/v1/settings/ai-delivery"))
    expect(withLanguage.status).toBe(400)

    // Exactly what the AI-automation page sends now. It used to send the whole
    // GET payload back, *Configured flags included, and the strict schema
    // refused every save while the card said «Сохранено!».
    const saved = await patchDelivery(patch(
      { telegramBotToken: "••••••••", telegramChatId: "-100", slackWebhookUrl: "" },
      "/api/v1/settings/ai-delivery",
    ))
    expect(saved.status).toBe(200)
    expect(stored()).toMatchObject({ language: "ru", telegramBotToken: "bot-secret", telegramChatId: "-100" })

    const echoed = await patchDelivery(patch(
      { telegramBotToken: "", telegramChatId: "", slackWebhookUrl: "", telegramBotTokenConfigured: true },
      "/api/v1/settings/ai-delivery",
    ))
    expect(echoed.status).toBe(400)
  })
})
