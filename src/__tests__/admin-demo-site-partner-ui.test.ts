// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SitePartnerForm } from "@/app/admin/demo-requests/site-partner-form"
import { TooltipProvider } from "@/components/ui/tooltip"

/**
 * Demo Center, «Заявки с сайтов партнёров». Owner, 2026-11-25: he types the
 * partner's address once; «Сохранить» stores it, «Не отправлять» removes it,
 * and the line under the field always says where requests go now.
 */
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ru = JSON.parse(readFileSync("messages/ru.json", "utf8"))
const dc = ru.admin.demoCenter as Record<string, string>

const fetchMock = vi.fn<typeof fetch>()
let root: Root
let host: HTMLDivElement

async function render(initialEmail: string | null) {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(createElement(NextIntlClientProvider, { locale: "ru", messages: ru },
      createElement(TooltipProvider, null, createElement(SitePartnerForm, { site: "biznesdoktoru.az", initialEmail }))))
  })
}

function button(label: string) {
  const found = Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.includes(label))
  if (!found) throw new Error(`no button «${label}»`)
  return found
}

async function type(value: string) {
  const input = host.querySelector("input") as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function click(target: HTMLElement) {
  await act(async () => { target.click() })
  await act(async () => { await Promise.resolve() })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe("site partner address in Demo Center", () => {
  it("says nobody gets the requests until an address is saved, then saves it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, site: "biznesdoktoru.az", email: "partner@agency.example" })))
    await render(null)

    expect(host.textContent).toContain(dc.sitePartnerNone)
    expect(host.textContent).toContain(dc.sitePartnerLabel.replace("{site}", "biznesdoktoru.az"))
    expect(host.textContent).not.toContain(dc.sitePartnerClear)

    await type("Partner@Agency.example")
    await click(button(dc.sitePartnerSave))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/v1/admin/demo-center/site-partner")
    expect(init?.method).toBe("PUT")
    expect(JSON.parse(String(init?.body))).toEqual({ site: "biznesdoktoru.az", email: "Partner@Agency.example" })
    expect(host.textContent).toContain(dc.sitePartnerSaved.replace("{email}", "partner@agency.example"))
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("partner@agency.example")
    expect(host.textContent).toContain(dc.sitePartnerClear)
  })

  it("stops sending with one button", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, site: "biznesdoktoru.az", email: null })))
    await render("partner@agency.example")
    expect(host.textContent).toContain(dc.sitePartnerCurrent.replace("{email}", "partner@agency.example"))

    await click(button(dc.sitePartnerClear))

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ site: "biznesdoktoru.az", email: "" })
    expect(host.textContent).toContain(dc.sitePartnerCleared)
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("")
  })

  it("names the problem in words when the server refuses the address", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false, code: "invalid_email" }), { status: 400 }))
    await render(null)
    await type("a@b.az, c@d.az")
    await click(button(dc.sitePartnerSave))

    expect(host.textContent).toContain(dc.sitePartnerInvalid)
    expect(host.textContent).toContain(dc.sitePartnerNone)
  })
})
