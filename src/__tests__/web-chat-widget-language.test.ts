import { readFileSync } from "node:fs"
import path from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import type { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The language of the website chat window, on a site that pastes the embed code
 * the CRM gives it — which has no data-lang.
 *
 * Found 2026-10-17: the widget then fell back to English. Both enabled widgets
 * on production belong to organizations with `settings.language = "az"`, and
 * one of them still had the schema's English title and greeting, so its
 * visitors read «Support», «Hi! How can we help?», «Your name (optional)»,
 * «Start chat» — and got AI replies under the English system prompt
 * (api-public-webchat-message-events.test.ts covers that half).
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    webChatWidget: { findUnique: vi.fn() },
    webChatSession: { create: vi.fn() },
    webChatMessage: { create: vi.fn() },
    organization: { findUnique: vi.fn() },
  },
}))
vi.mock("@/lib/rls-context", () => ({
  runWithTenant: vi.fn((_org: string, fn: () => unknown) => fn()),
  runWithRlsBypass: vi.fn((fn: () => unknown) => fn()),
}))
vi.mock("@/lib/widget-cors", () => ({
  buildWidgetCorsHeaders: vi.fn(async () => ({})),
  isOriginAllowed: vi.fn(() => true),
}))
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => true) }))
vi.mock("@/lib/web-chat-contact", () => ({ matchOrCreateWebChatContact: vi.fn(async () => null) }))

import { prisma } from "@/lib/prisma"
import EmbedChatPage from "@/app/embed/chat/[key]/page"
import { POST as START_SESSION } from "@/app/api/v1/public/web-chat/session/route"
import { SCHEMA_DEFAULT_GREETING, SCHEMA_DEFAULT_TITLE } from "@/app/embed/chat/[key]/widget-i18n"

const ORG_AZ = { language: "az" }

function widget(fields: Record<string, unknown> = {}, settings: unknown = ORG_AZ) {
  return {
    id: "w-1",
    organizationId: "org-1",
    publicKey: "wc_test",
    enabled: true,
    // The schema's defaults — what a widget nobody gave its own text carries.
    title: "Support",
    greeting: "Hi! How can we help?",
    primaryColor: "#0176D3",
    offlineMessage: null,
    workingHours: null,
    allowedOrigins: [],
    preChatForm: null,
    uiOptions: null,
    organization: { name: "Nümunə MMC", settings },
    ...fields,
  }
}

async function windowOnSite(input: { dataLang?: string; widget?: ReturnType<typeof widget> }) {
  vi.mocked(prisma.webChatWidget.findUnique).mockResolvedValue((input.widget ?? widget()) as never)
  // widget.js puts the page's data-lang into ?lang=, and nothing when the page set none.
  const searchParams = input.dataLang ? { lang: input.dataLang } : {}
  return renderToStaticMarkup(await EmbedChatPage({ params: Promise.resolve({ key: "wc_test" }), searchParams: Promise.resolve(searchParams) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.webChatSession.create).mockResolvedValue({ id: "ws-1" } as never)
  vi.mocked(prisma.webChatMessage.create).mockResolvedValue({ id: "wm-1" } as never)
})

describe("the chat window on a site that set no data-lang", () => {
  it("speaks the organization's Azerbaijani, not English", async () => {
    const html = await windowOnSite({})

    for (const az of ["Dəstək", "Salam! Sizə necə kömək edə bilərik?", "Adınız (istəyə bağlı)", "Email (istəyə bağlı)", "Telefon (istəyə bağlı)", "Çatı başlat"]) {
      expect(html, az).toContain(az)
    }
    for (const en of ["Support", "Hi! How can we help?", "Your name", "Start chat", "(optional)"]) {
      expect(html, en).not.toContain(en)
    }
  })

  it("speaks the organization's older settings.locale, else the application's default", async () => {
    expect(await windowOnSite({ widget: widget({}, { locale: "az" }) })).toContain("Çatı başlat")
    expect(await windowOnSite({ widget: widget({}, {}) })).toContain("Начать чат")
  })

  it("shows the organization's own title and greeting as written", async () => {
    const html = await windowOnSite({ widget: widget({ title: "LeadDrive Support", greeting: "Salam! Necə kömək edə bilərik?" }) })
    expect(html).toContain("LeadDrive Support")
    expect(html).toContain("Salam! Necə kömək edə bilərik?")
    expect(html).not.toContain("Dəstək")
  })
})

describe("the chat window on a site that set data-lang", () => {
  it("keeps the site's Russian over the organization's Azerbaijani", async () => {
    const html = await windowOnSite({ dataLang: "ru" })
    for (const ru of ["Поддержка", "Здравствуйте! Чем можем помочь?", "Ваше имя (необязательно)", "Начать чат"]) {
      expect(html, ru).toContain(ru)
    }
    expect(html).not.toContain("Çatı başlat")
  })

  it("keeps the site's English, too — chosen, it is no longer a fallback", async () => {
    const html = await windowOnSite({ dataLang: "en" })
    expect(html).toContain("Start chat")
    expect(html).toContain("Hi! How can we help?")
  })
})

describe("the greeting that opens the chat", () => {
  function start(body: Record<string, unknown>) {
    return START_SESSION(new Request("http://localhost/api/v1/public/web-chat/session", {
      method: "POST",
      body: JSON.stringify({ key: "wc_test", ...body }),
      headers: { origin: "https://example.az" },
    }) as unknown as NextRequest)
  }
  function greetingWritten() {
    type Written = { data: { fromRole: string; text: string; metadata?: unknown } }
    const writes = vi.mocked(prisma.webChatMessage.create).mock.calls.map(([arg]) => arg as unknown as Written)
    return writes.find((write) => write.data.fromRole === "bot")!.data
  }

  beforeEach(() => {
    vi.mocked(prisma.webChatWidget.findUnique).mockResolvedValue(widget() as never)
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ settings: ORG_AZ } as never)
  })

  it("is the widget's language when the site set none — and records that language for the ticket notice", async () => {
    const res = await start({ lang: "az", langChosen: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ data: { greeting: "Salam! Sizə necə kömək edə bilərik?" } })
    expect(greetingWritten()).toEqual(expect.objectContaining({ text: "Salam! Sizə necə kömək edə bilərik?", metadata: { widgetLang: "az" } }))
  })

  it("is the organization's language for a widget opened before it sent its language", async () => {
    expect((await start({})).status).toBe(200)
    expect(greetingWritten()).toEqual(expect.objectContaining({ text: "Salam! Sizə necə kömək edə bilərik?", metadata: { widgetLang: "az" } }))
  })

  it("is the site's language when the site set one", async () => {
    expect((await start({ lang: "ru", langChosen: true })).status).toBe(200)
    expect(greetingWritten()).toEqual(expect.objectContaining({ text: "Здравствуйте! Чем можем помочь?", metadata: { widgetLang: "ru" } }))
  })

  it("is the organization's own greeting as written", async () => {
    vi.mocked(prisma.webChatWidget.findUnique).mockResolvedValue(widget({ greeting: "Salam! Necə kömək edə bilərik?" }) as never)
    expect((await start({ lang: "ru", langChosen: true })).status).toBe(200)
    expect(greetingWritten().text).toBe("Salam! Necə kömək edə bilərik?")
  })
})

it("knows the schema's default title and greeting — a changed default would reach visitors in English again", () => {
  const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8")
  const model = schema.slice(schema.indexOf("model WebChatWidget {"))
  const body = model.slice(0, model.indexOf("\n}"))
  expect(body).toMatch(new RegExp(`\\btitle\\s+String\\s+@default\\("${SCHEMA_DEFAULT_TITLE}"\\)`))
  expect(body).toMatch(new RegExp(`\\bgreeting\\s+String\\s+@default\\("${SCHEMA_DEFAULT_GREETING.replace(/[?!]/g, "\\$&")}"\\)`))
})
