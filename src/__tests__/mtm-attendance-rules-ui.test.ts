// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceRulesForm } from "@/components/mtm/attendance-rules-form"
import { MTM_ATTENDANCE_BASELINE_RULE, type MtmAttendanceRule } from "@/lib/mtm/attendance-rules"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ENDPOINT = "/api/v1/mtm/attendance/rules"
const BASELINE = MTM_ATTENDANCE_BASELINE_RULE
const savedRule = (overrides: Partial<MtmAttendanceRule> = {}): MtmAttendanceRule => ({
  ...BASELINE, id: "rule-1", effectiveFrom: "2026-10-14", startTime: "08:00", endTime: "17:00",
  createdAt: "2026-10-13T10:00:00.000Z", createdBy: "fixture-admin", ...overrides,
})
const rulesData = (canManageRules = true, versions: MtmAttendanceRule[] = [], minEffectiveFrom = "2026-10-14") => ({
  current: BASELINE, versions, today: "2026-10-13", minEffectiveFrom, canManageRules,
})
const response = (data: unknown, status = 200, code?: string) => new Response(JSON.stringify({
  success: status < 400, data, code, error: "PRIVATE_SERVER_ERROR",
}), { status })

let container: HTMLDivElement
let root: Root
const fetchMock = vi.fn<typeof fetch>()
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
const input = (id: string) => container.querySelector<HTMLInputElement>(`#attendance-${id}`)!
const submit = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!
const posts = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")

async function render(locale = "ru") {
  const providerProps = {
    locale, messages: messages(locale), timeZone: "Asia/Baku", children: createElement(MtmAttendanceRulesForm),
  }
  await act(async () => root.render(createElement(NextIntlClientProvider, providerProps)))
}

async function edit(id: string, value: string) {
  const field = input(id)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
    field.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

async function sendForm() {
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => response(rulesData()))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("attendance rule form with real translations", () => {
  it.each(["ru", "az", "en"])("shows actual default rules and labelled fields in %s", async (locale) => {
    await render(locale)
    const t = messages(locale).mtmAttendance
    expect(container.textContent).toContain(t.rulesTitle)
    expect(container.textContent).toContain(t.rulesHistoryPreserved)
    expect(container.textContent).toContain(t.rulesDefaultVersion)
    expect(container.textContent).not.toMatch(/0001-01-01|mtmAttendance\.|PRIVATE_SERVER_ERROR/)
    expect(input("start").value).toBe("09:00")
    expect(input("end").value).toBe("18:00")
    // Lunch is a time window (owner, 2026-10-16); a rule saved with its length alone starts at 13:00.
    expect(input("lunch").value).toBe("13:00"); expect(input("lunch-end").value).toBe("14:00")
    expect(input("grace").value).toBe("10")
    expect(input("effective-from").value).toBe("2026-10-14")
    expect(input("effective-from").min).toBe("2026-10-14")
    for (const id of ["start", "end", "lunch", "grace", "effective-from"]) {
      expect(container.querySelector(`label[for="attendance-${id}"]`)?.textContent).toBeTruthy()
    }
    expect(Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')).map((field) => Number(field.value)).sort())
      .toEqual([0, 6])
    expect(submit().textContent).toBe(t.rulesSave)
    // Optional evidence capture of this same real render, with its actual
    // translations and component classes; never a second hand-drawn screen.
    const renderDirectory = process.env.MTM_ATTENDANCE_RENDER_DIR
    if (renderDirectory) {
      mkdirSync(renderDirectory, { recursive: true })
      writeFileSync(join(renderDirectory, `attendance-rules-${locale}.html`), `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Attendance rules</title><link rel="stylesheet" href="./attendance.css">
<style>html{background:#f4f4f5;color:#18181b}body{box-sizing:border-box;width:100%;max-width:1360px;margin:0 auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style>
</head><body>${container.innerHTML}</body></html>`, "utf8")
    }
  })

  it("lets a manager read current and scheduled versions without an editable form", async () => {
    fetchMock.mockImplementation(async () => response(rulesData(false, [savedRule()], "2026-10-15")))
    await render()
    expect(container.textContent).toContain(messages("ru").mtmAttendance.rulesReadOnly)
    expect(container.querySelector('button[type="submit"]')).toBeNull()
    expect(Array.from(container.querySelectorAll("input")).every((field) => field.matches(":disabled"))).toBe(true)
    expect(input("start").value).toBe("09:00")
    expect(container.querySelectorAll('[data-testid="attendance-rule-version"]')).toHaveLength(2)
    await sendForm()
    expect(posts()).toHaveLength(0)
  })

  it("prefills the latest scheduled rule and the server's available date for the next change", async () => {
    fetchMock.mockImplementation(async () => response(rulesData(true, [savedRule()], "2026-10-15")))
    await render()
    expect(input("start").value).toBe("08:00")
    expect(input("effective-from").value).toBe("2026-10-15")
    expect(container.textContent).toContain("Сейчас рабочий день: 09:00–18:00")
  })

  it("saves one future version and keeps today's rule visible", async () => {
    fetchMock.mockImplementation(async (_url, options) => options?.method === "POST"
      ? response(savedRule({ lunchMinutes: 45, lateGraceMinutes: 5 }), 201) : response(rulesData()))
    await render()
    await edit("start", "08:00")
    await edit("end", "17:00")
    await edit("lunch", "12:30"); await edit("lunch-end", "13:15")
    await edit("grace", "5")
    await sendForm()
    expect(posts()).toHaveLength(1)
    expect(posts()[0][0]).toBe(ENDPOINT)
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
      effectiveFrom: "2026-10-14", startTime: "08:00", endTime: "17:00", lunchMinutes: 45, lunchStart: "12:30", lateGraceMinutes: 5, weekendDays: [0, 6],
    })
    expect(container.textContent).toContain("Сейчас рабочий день: 09:00–18:00")
    expect(container.textContent).toContain("Правила сохранены")
    expect(container.textContent).toContain("Запланированы")
    expect(container.querySelectorAll('[data-testid="attendance-rule-version"]')).toHaveLength(2)
    expect(input("effective-from").value).toBe("2026-10-15")
    expect(container.textContent).not.toContain("fixture-admin")
  })

  it("refuses a lunch outside the working day, or with one time only, before sending", async () => {
    await render()
    await edit("lunch", "08:30"); await sendForm()
    expect(posts()).toHaveLength(0)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("ru").mtmAttendance.rulesLunchInvalid)
    await edit("lunch", "13:00"); await edit("lunch-end", ""); await sendForm()
    expect(posts()).toHaveLength(0)
  })

  it("sends no lunch when both times are empty", async () => {
    fetchMock.mockImplementation(async (_url, options) => options?.method === "POST" ? response(savedRule({ lunchMinutes: 0 }), 201) : response(rulesData()))
    await render(); await edit("lunch", ""); await edit("lunch-end", ""); await sendForm()
    expect(JSON.parse(String(posts()[0][1]?.body))).toMatchObject({ lunchMinutes: 0, lunchStart: null })
  })

  it.each([["grace", "121"], ["end", "08:00"]])("refuses invalid %s before sending", async (id, value) => {
    await render()
    await edit(id, value)
    await sendForm()
    expect(posts()).toHaveLength(0)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("ru").mtmAttendance.rulesInvalid)
  })

  it("recovers from a failed load without printing private server errors", async () => {
    fetchMock.mockResolvedValueOnce(response(null, 500)).mockResolvedValueOnce(response(rulesData()))
    await render("az")
    expect(container.querySelector("form")).toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("az").mtmAttendance.rulesLoadError)
    expect(container.textContent).not.toContain("PRIVATE_SERVER_ERROR")
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click())
    expect(input("start").value).toBe("09:00")
  })

  it.each([
    ["MTM_ATTENDANCE_RULE_CONFLICT", "rulesConflict"],
    ["MTM_ATTENDANCE_RULE_FUTURE_REQUIRED", "rulesFutureRequired"],
  ])("keeps an unsaved draft on %s and requires a fresh read before retrying", async (code, messageKey) => {
    fetchMock.mockImplementation(async (_url, options) => options?.method === "POST"
      ? response(null, 409, code) : response(rulesData()))
    await render()
    await edit("start", "08:30")
    await sendForm()
    expect(input("start").value).toBe("08:30")
    expect(submit().disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("ru").mtmAttendance[messageKey])
    await sendForm()
    expect(posts()).toHaveLength(1)
  })

  it("does not offer a blind second save when the network lost the result", async () => {
    fetchMock.mockImplementation(async (_url, options) => {
      if (options?.method === "POST") throw new Error("PRIVATE_NETWORK_ERROR")
      return response(rulesData())
    })
    await render()
    await sendForm()
    expect(submit().disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("ru").mtmAttendance.rulesSaveUnconfirmed)
    expect(container.textContent).not.toContain("PRIVATE_NETWORK_ERROR")
  })

  it("removes rules immediately when save discovers that access has been revoked", async () => {
    fetchMock.mockImplementation(async (_url, options) => options?.method === "POST"
      ? response(null, 403, "MTM_ATTENDANCE_ADMIN_REQUIRED") : response(rulesData()))
    await render()
    await sendForm()
    expect(container.querySelector("form")).toBeNull()
    expect(container.querySelectorAll('[data-testid="attendance-rule-version"]')).toHaveLength(0)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("ru").mtmAttendance.rulesAccessUnavailable)
  })
})
