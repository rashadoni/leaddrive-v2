// @vitest-environment jsdom

import { act, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * «Куда попадают сообщения с этого номера» inside the channel's own «Изменить настройку» form.
 *
 * The choice between the inbox and Service Desk (lib/channels/whatsapp-inbound-purpose) first shipped
 * only as a line under the number's row. The owner opened this form instead — the big button on the
 * same row — found nothing to press, and sent the screenshot (2026-11-21). So the two cards are here
 * too, and the form's own Save stores them: through the number's endpoint, because the key is
 * server-owned and the form's PUT can neither write nor erase it.
 *
 * The real form on real React; only the network is a recorder.
 */
vi.mock("next-intl", () => ({
  useLocale: () => "ru",
  useTranslations: () => {
    const translate = (key: string) => key
    translate.has = () => false
    return translate
  },
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({ asChild, children, variant: _variant, size: _size, ...props }: { asChild?: boolean; children?: ReactNode; variant?: string; size?: string; [key: string]: unknown }) => {
    void _variant
    void _size
    if (asChild && isValidElement(children)) return cloneElement(children as ReactElement<Record<string, unknown>>, props)
    return createElement("button", props, children)
  },
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) => (open ? createElement("div", null, children) : null),
  DialogContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement("h2", null, children),
  DialogFooter: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}))

import { ChannelConfigForm } from "@/components/channel-config-form"

type Call = { url: string; method: string; body: Record<string, unknown> | null }

let container: HTMLDivElement
let root: Root
let calls: Call[]
let purposeSaveOk: boolean

/** A WhatsApp number as the channels list hands it to the form: credentials stored, none of them shown. */
function number(settings: Record<string, unknown>) {
  return {
    id: "wa-1",
    configName: "Zeytun Pharmaceuticals",
    channelType: "whatsapp",
    isActive: true,
    settings,
    hasAccessToken: true,
    hasPhoneNumberId: true,
    hasBusinessAccountId: true,
    hasVerifyToken: true,
    hasAppSecret: true,
  }
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  calls = []
  purposeSaveOk = true
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method || "GET"
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null })
    // Meta's Embedded Signup is not configured here: the form shows its manual fields.
    if (url.includes("/embedded-signup")) return new Response(JSON.stringify({ configured: false }))
    if (url.endsWith("/whatsapp-purpose")) return new Response("{}", { status: purposeSaveOk ? 200 : 500 })
    if (method === "PUT" || method === "POST") return new Response(JSON.stringify({ data: { id: "wa-1" } }), { status: method === "POST" ? 201 : 200 })
    return new Response("{}")
  }))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
const card = (purpose: string) => container.querySelector<HTMLButtonElement>(`[data-testid="whatsapp-number-purpose-${purpose}"]`)!
const writes = () => calls.filter((call) => call.method !== "GET")

async function openForm(initialData: ReturnType<typeof number> | undefined) {
  const onSaved = vi.fn()
  const onOpenChange = vi.fn()
  await act(async () => {
    root.render(createElement(ChannelConfigForm, {
      open: true,
      onOpenChange,
      onSaved,
      initialData: initialData as never,
      ...(initialData ? {} : { lockChannelType: true }),
    }))
  })
  await settle()
  return { onSaved, onOpenChange }
}

async function save() {
  const form = container.querySelector("form")!
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
  await settle()
  await settle()
}

describe("the channel form of a WhatsApp number", () => {
  it("shows the choice between the inbox and Service Desk, with what the number does today marked", async () => {
    await openForm(number({ replyMode: "agent" }))

    const block = container.querySelector('[data-testid="channel-form-whatsapp-purpose"]')!
    expect(block.textContent).toContain("Куда попадают сообщения с этого номера")
    expect(card("support").getAttribute("aria-checked")).toBe("true")
    expect(card("conversations").getAttribute("aria-checked")).toBe("false")
    expect(card("conversations").textContent).toContain("Сообщения видны только в Omni-Channel")
  })

  it("stores «Переписка» on the form's own Save, through the number's endpoint and not in the form's settings", async () => {
    const { onSaved, onOpenChange } = await openForm(number({ replyMode: "agent" }))

    await act(async () => card("conversations").click())
    expect(card("conversations").getAttribute("aria-checked")).toBe("true")
    expect(container.querySelector('[data-testid="channel-form-whatsapp-purpose"]')!.textContent).toContain("Уже открытые тикеты остаются")
    expect(writes()).toEqual([])

    await save()

    expect(writes().map((call) => `${call.method} ${call.url}`)).toEqual([
      "PUT /api/v1/channels/wa-1",
      "PUT /api/v1/channels/wa-1/whatsapp-purpose",
    ])
    expect(writes()[0].body?.settings ?? {}).not.toHaveProperty("inboundPurpose")
    expect(writes()[1].body).toEqual({ purpose: "conversations" })
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("sends nothing about the purpose when it was not changed", async () => {
    await openForm(number({ inboundPurpose: "conversations" }))
    expect(card("conversations").getAttribute("aria-checked")).toBe("true")

    await save()

    expect(writes().map((call) => `${call.method} ${call.url}`)).toEqual(["PUT /api/v1/channels/wa-1"])
  })

  it("stays open with an error when the purpose could not be stored", async () => {
    purposeSaveOk = false
    const { onSaved, onOpenChange } = await openForm(number({ inboundPurpose: "conversations" }))

    await act(async () => card("support").click())
    await save()

    expect(writes().at(-1)).toMatchObject({ url: "/api/v1/channels/wa-1/whatsapp-purpose", body: { purpose: "support" } })
    expect(onSaved).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(container.textContent).toContain("failedToSave")
  })

  it("shows no such choice on a channel that is not WhatsApp", async () => {
    await openForm({ ...number({}), channelType: "telegram", hasBotToken: true } as never)

    expect(container.querySelector('[data-testid="channel-form-whatsapp-purpose"]')).toBeNull()
  })
})
