// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import en from "../../messages/en.json"

const translations = new Map<string, ReturnType<typeof translateNamespace>>()
function translateNamespace(namespace: string) {
  const translate = (key: string, values?: Record<string, unknown>): string => {
    let result: unknown = (en as Record<string, unknown>)[namespace]
    for (const part of key.split(".")) result = (result as Record<string, unknown>)?.[part]
    return String(result ?? key).replace(/\{(\w+)\}/g, (match, name: string) => String(values?.[name] ?? match))
  }
  translate.rich = (key: string) => translate(key).replace(/<\/?link>/g, "")
  return translate
}
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: (namespace: string) => {
    if (!translations.has(namespace)) translations.set(namespace, translateNamespace(namespace))
    return translations.get(namespace)
  },
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { organizationId: "org-1", organizationSlug: "test" } } }) }))
vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }))
vi.mock("@/components/settings/customer-phone-privacy", () => ({ CustomerPhonePrivacy: () => null }))
vi.mock("@/components/help/help-button", () => ({ HelpButton: () => null }))
vi.mock("@/components/tour/tour-provider", () => ({ useAutoTour: () => undefined }))
vi.mock("@/components/tour/tour-replay-button", () => ({ TourReplayButton: () => null }))

import WhatsAppSettingsPage from "@/app/(dashboard)/settings/channels/whatsapp/page"

const channels = [
  { id: "sender-a", configName: "Main office", displayName: "Main office" },
  { id: "sender-b", configName: "Second office", displayName: "Second office" },
]
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
const templateData = (channel: string) => response({
  success: true,
  data: [{ id: `${channel}-template`, name: `${channel}_update`, status: "APPROVED", category: "UTILITY", language: "en", variables: [], bodyText: "Your request is ready.", buttons: null }],
  meta: { hasConfig: true, displayName: channel, lastValidatedAt: null, lastTemplateSyncAt: null },
})
const notificationData = (legacy = false, value = "") => response({ success: true, ticketStatuses: ["new", "in_progress"], legacyFallbackEnabled: legacy, data: { whatsappTicketStatusTemplates: value ? { new: value } : {}, whatsappSurveyTemplate: "", whatsappJourneyDefaultTemplate: "" } })
const choice = (name: string, language = "") => name ? JSON.stringify([name, language]) : ""

async function flush() {
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve() })
}

describe("WhatsApp settings — understandable and channel-bound interactions", () => {
  let root: Root
  let container: HTMLDivElement
  let fetchMock: Mock<(input: string, init?: RequestInit) => Promise<ReturnType<typeof response>>>

  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "https://local.test")
      if (url.pathname.endsWith("/channels")) return response({ success: true, data: channels })
      if (url.pathname.endsWith("/notification-settings")) return init?.method === "PUT" ? response({ success: true }) : notificationData()
      return templateData(url.searchParams.get("channelConfigId") || "wrong")
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function mount() { await act(async () => root.render(createElement(WhatsAppSettingsPage))); await flush() }
  async function select(id: string, value: string) {
    await act(async () => {
      const element = container.querySelector<HTMLSelectElement>(`#${id}`)!
      element.value = value
      element.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await flush()
  }
  function button(text: string) {
    return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((element) => element.textContent?.includes(text))!
  }
  async function click(text: string) { await act(async () => button(text).click()); await flush() }

  it("requires a choice with multiple senders, then loads only that sender and human status labels", async () => {
    await mount()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(button("Check number").disabled).toBe(true)
    expect(container.textContent).toContain("Choose a WhatsApp connection above")
    await select("wa-selected-channel", "sender-b")
    const calls = fetchMock.mock.calls.map(([url]) => url as string)
    expect(calls).toContain("/api/v1/whatsapp/templates?status=all&channelConfigId=sender-b")
    expect(calls).toContain("/api/v1/whatsapp/notification-settings?channelConfigId=sender-b")
    expect(container.querySelector('label[for="wa-status-in_progress"]')?.textContent).toBe("In progress")
    expect(container.textContent).not.toContain("send_whatsapp")
    expect(container.textContent).not.toContain("{{status}}")
    expect(container.textContent).not.toContain("{{agentName}}")
    expect(container.textContent).toContain("{{ticketNumber}}")
    expect(container.querySelector("#wa-templates")!.compareDocumentPosition(container.querySelector("#wa-notifications")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true)
  })

  it("ignores a slow response for the previous sender", async () => {
    let resolveA!: (value: ReturnType<typeof response>) => void
    let resolveSettingsA!: (value: ReturnType<typeof response>) => void
    const defaultFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/templates?") && url.includes("sender-a")) return new Promise((resolve) => { resolveA = resolve })
      if (url.includes("/notification-settings?") && url.includes("sender-a")) return new Promise((resolve) => { resolveSettingsA = resolve })
      return defaultFetch(url, init)
    })
    await mount()
    await select("wa-selected-channel", "sender-a")
    await select("wa-selected-channel", "sender-b")
    await act(async () => resolveA(templateData("sender-a")))
    await act(async () => resolveSettingsA(response({ success: true, ticketStatuses: ["new"], data: {
      whatsappTicketStatusTemplates: { new: "sender-a_update" }, whatsappTicketStatusTemplateLanguages: { new: "ru" },
      whatsappSurveyTemplate: "sender-a_update", whatsappSurveyTemplateLanguage: "ru",
      whatsappJourneyDefaultTemplate: "sender-a_update", whatsappJourneyDefaultTemplateLanguage: "az",
    } })))
    await flush()
    expect(container.textContent).toContain("sender-b_update")
    expect(container.textContent).not.toContain("sender-a_update")
    for (const id of ["wa-status-new", "wa-survey-template", "wa-journey-template"]) {
      expect(container.querySelector<HTMLSelectElement>(`#${id}`)!.value).toBe("")
    }
  })

  it("keeps saved unavailable choices visible and asks before discarding edits on a sender switch", async () => {
    const defaultFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.includes("/notification-settings")
      ? response({ success: true, ticketStatuses: ["new"], data: {
        whatsappTicketStatusTemplates: { new: "old_template" }, whatsappTicketStatusTemplateLanguages: { new: "ru" },
      } }) : defaultFetch(url, init))
    await mount()
    await select("wa-selected-channel", "sender-a")
    const status = container.querySelector<HTMLSelectElement>("#wa-status-new")!
    expect(status.value).toBe(choice("old_template", "ru"))
    expect(status.selectedOptions[0].textContent).toContain("old_template (ru) — saved, currently unavailable")
    await select("wa-status-new", "")
    await select("wa-selected-channel", "sender-b")
    expect(container.querySelector<HTMLSelectElement>("#wa-selected-channel")!.value).toBe("sender-a")
    expect(container.textContent).toContain("unsaved notification changes")
    await click("Discard and switch")
    expect(container.querySelector<HTMLSelectElement>("#wa-selected-channel")!.value).toBe("sender-b")
  })

  it("prevents overwriting settings after a failed read", async () => {
    const defaultFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.includes("/notification-settings") ? response({ success: false, error: "denied" }, 403) : defaultFetch(url, init))
    await mount()
    await select("wa-selected-channel", "sender-a")
    expect(container.textContent).toContain("locked to avoid overwriting")
    expect(button("Save notifications").disabled).toBe(true)
  })

  it("explains and explicitly saves legacy fallback as off, without sending a message", async () => {
    const defaultFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.includes("/notification-settings") && !init?.method ? notificationData(true) : defaultFetch(url, init))
    await mount()
    await select("wa-selected-channel", "sender-b")
    expect(container.textContent).toContain("existing automatic notifications may still send plain text")
    expect(button("Save notifications").disabled).toBe(false)
    await click("Save notifications")
    const saved = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")!
    expect(saved[0]).toBe("/api/v1/whatsapp/notification-settings?channelConfigId=sender-b")
    expect(JSON.parse(saved[1]!.body as string)).toEqual({
      whatsappTicketStatusTemplates: {}, whatsappTicketStatusTemplateLanguages: {},
      whatsappSurveyTemplate: "", whatsappSurveyTemplateLanguage: "",
      whatsappJourneyDefaultTemplate: "", whatsappJourneyDefaultTemplateLanguage: "",
    })
    expect(container.textContent).toContain("Notification choices saved")
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/send"))).toBe(false)
  })

  it("preserves legacy choices and roundtrips the chosen RU/AZ version without confusing the same template name", async () => {
    let savedSettings = {
      whatsappTicketStatusTemplates: { new: "welcome" },
      whatsappTicketStatusTemplateLanguages: {} as Record<string, string>,
      whatsappSurveyTemplate: "welcome", whatsappSurveyTemplateLanguage: "",
      whatsappJourneyDefaultTemplate: "welcome", whatsappJourneyDefaultTemplateLanguage: "",
    }
    const defaultFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("sender-a") && url.includes("/templates?")) return response({ success: true,
        data: ["az", "ru"].map(language => ({ id: `welcome-${language}`, name: "welcome", language,
          status: "APPROVED", category: "UTILITY", bodyText: "Your request is ready.", variables: [], buttons: null })),
        meta: { hasConfig: true },
      })
      if (url.includes("sender-a") && url.includes("/notification-settings?")) {
        if (init?.method === "PUT") savedSettings = JSON.parse(String(init.body)) as typeof savedSettings
        return response({ success: true, ticketStatuses: ["new"], data: savedSettings })
      }
      return defaultFetch(url, init)
    })
    await mount()
    await select("wa-selected-channel", "sender-a")
    const selects = ["wa-status-new", "wa-survey-template", "wa-journey-template"]
    for (const id of selects) {
      const element = container.querySelector<HTMLSelectElement>(`#${id}`)!
      expect(element.value).toBe(choice("welcome"))
      expect(element.selectedOptions[0].textContent).toContain("saved without a language")
      expect([...element.options].filter(option => option.textContent === "welcome (ru)").map(option => option.value)).toEqual([choice("welcome", "ru")])
      expect([...element.options].filter(option => option.textContent === "welcome (az)").map(option => option.value)).toEqual([choice("welcome", "az")])
    }
    await click("Save notifications")
    expect(savedSettings.whatsappTicketStatusTemplateLanguages).toEqual({})
    expect(savedSettings.whatsappSurveyTemplateLanguage).toBe("")
    expect(savedSettings.whatsappJourneyDefaultTemplateLanguage).toBe("")

    await select("wa-status-new", choice("welcome", "ru"))
    await select("wa-survey-template", choice("welcome", "az"))
    await select("wa-journey-template", choice("welcome", "ru"))
    await click("Save notifications")
    expect(savedSettings).toEqual({
      whatsappTicketStatusTemplates: { new: "welcome" }, whatsappTicketStatusTemplateLanguages: { new: "ru" },
      whatsappSurveyTemplate: "welcome", whatsappSurveyTemplateLanguage: "az",
      whatsappJourneyDefaultTemplate: "welcome", whatsappJourneyDefaultTemplateLanguage: "ru",
    })

    // A language-only edit is unsaved work even when the template name is unchanged.
    await select("wa-status-new", choice("welcome", "az"))
    await select("wa-selected-channel", "sender-b")
    expect(container.querySelector<HTMLSelectElement>("#wa-selected-channel")!.value).toBe("sender-a")
    await click("Discard and switch")
    for (const id of selects) expect(container.querySelector<HTMLSelectElement>(`#${id}`)!.value).toBe("")
    await select("wa-selected-channel", "sender-a")
    expect(container.querySelector<HTMLSelectElement>("#wa-status-new")!.value).toBe(choice("welcome", "ru"))
    expect(container.querySelector<HTMLSelectElement>("#wa-survey-template")!.value).toBe(choice("welcome", "az"))
    expect(container.querySelector<HTMLSelectElement>("#wa-journey-template")!.value).toBe(choice("welcome", "ru"))

    for (const id of selects) await select(id, "")
    await click("Save notifications")
    expect(savedSettings).toEqual({
      whatsappTicketStatusTemplates: {}, whatsappTicketStatusTemplateLanguages: {},
      whatsappSurveyTemplate: "", whatsappSurveyTemplateLanguage: "",
      whatsappJourneyDefaultTemplate: "", whatsappJourneyDefaultTemplateLanguage: "",
    })
  })

  it("distinguishes a verified phone from denied template access", async () => {
    const defaultFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/validate")) return response({ ok: true, verifiedName: "Sample business", displayPhoneNumber: "+10000000000" })
      if (url.includes("/templates?") && init?.method === "POST") return response({ success: false, error: "(#200) You do not have permission to access this field." }, 403)
      if (url.includes("/templates?")) return response({ success: true, data: [], meta: { hasConfig: true } })
      return defaultFetch(url, init)
    })
    await mount()
    await select("wa-selected-channel", "sender-a")
    await click("Check number")
    await click("Load templates from Meta")
    expect(container.textContent).toContain("Sample business")
    expect(container.textContent).toContain("Meta has not allowed this connection to read templates")
    expect(container.textContent).toContain("successful phone check does not confirm template access")
    expect(container.textContent).toContain("Templates not loaded")
    expect(container.textContent).not.toContain("No templates yet")
    expect(container.textContent?.match(/successful phone check does not confirm template access/g)).toHaveLength(1)
    expect(button("Submit to Meta").disabled).toBe(true)
  })
})
