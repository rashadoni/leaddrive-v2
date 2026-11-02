// @vitest-environment jsdom
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MtmAttendanceCalendar } from "@/components/mtm/attendance-calendar"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const ENDPOINT = "/api/v1/mtm/attendance/calendar"
const future = { id: "future", date: "2026-10-20", kind: "COMPANY_HOLIDAY", name: "Company anniversary", updatedAt: "2026-10-12T10:00:00.000Z", canEdit: true }
const past = { ...future, id: "past", date: "2026-10-12", name: "Past entry" }
const today = { ...future, id: "today", date: "2026-10-13", name: "Today entry" }
const paired = { ...future, id: "paired", date: "2026-10-24", kind: "MOVED_WORKDAY", name: "Moved entry", canEdit: false }
const data = (canManage = true, days = [past, today, future, paired]) => ({ today: "2026-10-13", days, canManage })
const response = (value: unknown, status = 200, code?: string) => new Response(JSON.stringify({ success: status < 400, data: value, code, error: "PRIVATE_SERVER_ERROR" }), { status })
const messages = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
const fetchMock = vi.fn<typeof fetch>()
let container: HTMLDivElement
let root: Root
const input = (name: string) => container.querySelector<HTMLInputElement>(`#attendance-calendar-${name}`)!
const button = (text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === text)!
const mutations = () => fetchMock.mock.calls.filter(([, options]) => options?.method === "POST" || options?.method === "DELETE")
async function render(locale = "en") {
  const providerProps = { locale, messages: messages(locale), timeZone: "Asia/Baku", children: createElement(MtmAttendanceCalendar) }
  await act(async () => root.render(createElement(NextIntlClientProvider, providerProps)))
}
async function edit(name: string, value: string) {
  const field = input(name)
  await act(async () => {
    const prototype = field.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
    field.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
async function click(label: string) { await act(async () => button(label).click()) }
async function submit() { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })) }) }

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => response(data()))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

describe("MTM attendance organization calendar UI", () => {
  // Owner, 2026-10-15: Azerbaijan's holidays with one press; the source and the gaps are said in words.
  it("adds the year's official holidays with one press, reloads and reports what was added", async () => {
    fetchMock.mockImplementation(async (url, options) => String(url).endsWith("/official") ? response({ year: 2026, added: 4, existing: 0, past: 21, complete: true, source: "x" }) : response(data()))
    await render("ru")
    const ru = messages("ru").mtmAttendance
    const block = container.querySelector('[data-testid="attendance-calendar-official"]')!
    expect(block.textContent).toContain(ru.calendarOfficialTitle.replace("{year}", "2026"))
    expect(block.textContent).toMatch(/362/)
    await click(ru.calendarOfficialAdd.replace("{year}", "2026"))
    const call = fetchMock.mock.calls.find(([url]) => String(url) === `${ENDPOINT}/official`)!
    expect(call[1]!.method).toBe("POST"); expect(JSON.parse(String(call[1]!.body))).toEqual({ year: 2026 })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith(`${ENDPOINT}?from=2026-01-01`))).toHaveLength(1)
    expect(container.querySelector('[data-testid="attendance-calendar-official-result"]')!.textContent).toBe("Добавлено дней: 4. Уже были внесены: 0. Прошедшие даты не добавляются: 21.")
    await edit("year", "2027")
    expect(container.querySelector('[data-testid="attendance-calendar-official"]')!.textContent).toContain(ru.calendarOfficialPartial.replace("{year}", "2027"))
  })
  it.each(["ru", "az", "en"])("renders real labels, entries and readonly boundaries in %s", async (locale) => {
    await render(locale)
    const t = messages(locale).mtmAttendance
    expect(container.textContent).toContain(t.calendarTitle)
    expect(container.textContent).toContain(t.calendarIntro)
    expect(container.textContent).toContain(t.calendarPublicHoliday)
    expect(container.textContent).toContain(t.calendarPastReadOnly)
    expect(container.textContent).toContain(t.calendarPairedReadOnly)
    expect(container.textContent).not.toMatch(/mtmAttendance\.|PRIVATE_SERVER_ERROR|MOVED_WORKDAY/)
    expect(container.querySelectorAll('[data-testid="attendance-calendar-day"]')).toHaveLength(4)
    expect(Array.from(container.querySelectorAll("button")).filter((item) => item.textContent === t.calendarEdit)).toHaveLength(1)
    expect(input("date").min).toBe("2026-10-14")
    expect(input("date").value).toBe("2026-10-14")
    for (const name of ["year", "date", "kind", "name"]) expect(container.querySelector(`label[for="attendance-calendar-${name}"]`)?.textContent).toBeTruthy()
    expect(Array.from(container.querySelectorAll("#attendance-calendar-year option")).map((item) => item.textContent)).toEqual(["2026", "2027"])
    const capture = process.env.MTM_ATTENDANCE_RENDER_DIR
    if (capture) {
      mkdirSync(capture, { recursive: true })
      writeFileSync(join(capture, `attendance-calendar-${locale}.html`), `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attendance calendar</title><link rel="stylesheet" href="./attendance.css"><style>html{background:#f4f4f5;color:#18181b}body{box-sizing:border-box;width:100%;max-width:1360px;margin:0 auto;padding:32px;font-family:Arial,sans-serif}*,*::before,*::after{box-sizing:border-box}@media(max-width:600px){body{padding:16px}}</style></head><body>${container.innerHTML}</body></html>`, "utf8")
    }
  })

  it("shows empty as not filled, without inventing holidays, and loads the selected year", async () => {
    fetchMock.mockImplementation(async () => response(data(true, [])))
    await render()
    expect(container.textContent).toContain("No special dates have been entered for 2026")
    expect(container.querySelectorAll('[data-testid="attendance-calendar-day"]')).toHaveLength(0)
    await edit("year", "2027")
    expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith(`${ENDPOINT}?`)).at(-1)?.[0]).toBe(`${ENDPOINT}?from=2027-01-01&to=2027-12-31`)
    // The admin also asks what the watch has for that year.
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(`${ENDPOINT}/official?year=2027`)
    expect(container.textContent).toContain("No special dates have been entered for 2027")
  })

  it("gives managers a calendar without mutation controls", async () => {
    fetchMock.mockImplementation(async () => response(data(false)))
    await render()
    expect(container.textContent).toContain(messages("en").mtmAttendance.calendarReadOnly)
    expect(container.querySelector("form")).toBeNull()
    expect(button("Edit")).toBeUndefined()
    expect(button("Delete")).toBeUndefined()
    expect(mutations()).toHaveLength(0)
  })

  it("creates a manual future date with a trimmed name and shows the confirmed result", async () => {
    fetchMock.mockImplementation(async (_, options) => options?.method === "POST"
      ? response({ ...future, id: "new", date: "2026-10-14", kind: "PUBLIC_HOLIDAY", name: "Manual holiday" }) : response(data()))
    await render()
    await edit("name", "  Manual holiday  ")
    await submit()
    expect(JSON.parse(String(mutations()[0][1]?.body))).toEqual({ date: "2026-10-14", kind: "PUBLIC_HOLIDAY", name: "Manual holiday" })
    expect(container.textContent).toContain("Manual holiday")
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Calendar saved.")
    expect(input("name").value).toBe("")
  })

  it("edits with the original version and replaces the old row with the server's new row", async () => {
    fetchMock.mockImplementation(async (_, options) => options?.method === "POST"
      ? response({ ...future, id: "new-version", kind: "EXCEPTION_WORKDAY", name: "Working Saturday" }) : response(data()))
    await render()
    await click("Edit")
    expect(input("date").value).toBe(future.date)
    expect(input("name").value).toBe(future.name)
    await edit("kind", "EXCEPTION_WORKDAY")
    await edit("name", "Working Saturday")
    await submit()
    expect(JSON.parse(String(mutations()[0][1]?.body))).toEqual({ id: future.id, version: future.updatedAt, date: future.date, kind: "EXCEPTION_WORKDAY", name: "Working Saturday" })
    expect(container.querySelectorAll('[data-testid="attendance-calendar-day"]')).toHaveLength(4)
    expect(container.textContent).not.toContain("Company anniversary")
    expect(container.textContent).toContain("Working Saturday")
  })

  it("requires an explicit deletion confirmation and sends the version", async () => {
    fetchMock.mockImplementation(async (_, options) => options?.method === "DELETE" ? response(null) : response(data()))
    await render()
    await click("Delete")
    expect(mutations()).toHaveLength(0)
    await click("Cancel")
    expect(mutations()).toHaveLength(0)
    await click("Delete")
    await click("Delete entry")
    expect(mutations()[0][1]?.method).toBe("DELETE")
    expect(JSON.parse(String(mutations()[0][1]?.body))).toEqual({ id: future.id, version: future.updatedAt })
    expect(container.textContent).not.toContain("Company anniversary")
    expect(container.querySelectorAll('[data-testid="attendance-calendar-day"]')).toHaveLength(3)
  })

  it.each([["name", ""], ["date", "2026-10-13"]])("refuses invalid %s before a network mutation", async (field, value) => {
    await render()
    await edit("name", "Company day")
    await edit(field, value)
    await submit()
    expect(mutations()).toHaveLength(0)
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  })

  it.each([
    ["MTM_ATTENDANCE_CALENDAR_CHANGED", "calendarChanged"], ["MTM_ATTENDANCE_CALENDAR_PAST", "calendarPast"],
    ["MTM_ATTENDANCE_CALENDAR_EXISTS", "calendarExists"], ["MTM_ATTENDANCE_CALENDAR_PAIRED", "calendarPaired"],
  ])("requires a fresh read after %s", async (code, key) => {
    fetchMock.mockImplementation(async (_, options) => options?.method === "POST" ? response(null, 409, code) : response(data()))
    await render()
    await edit("name", "Company day")
    await submit()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("en").mtmAttendance[key])
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
    expect(input("name").value).toBe("Company day")
    await submit()
    expect(mutations()).toHaveLength(1)
    await click("Refresh calendar")
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  })

  it("does not blindly retry deletion after a lost response", async () => {
    fetchMock.mockImplementation(async (_, options) => { if (options?.method === "DELETE") throw new Error("PRIVATE_NETWORK_ERROR"); return response(data()) })
    await render()
    await click("Delete")
    await click("Delete entry")
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("en").mtmAttendance.calendarSaveUnconfirmed)
    expect(button("Delete entry").disabled).toBe(true)
    expect(container.textContent).not.toContain("PRIVATE_NETWORK_ERROR")
    expect(mutations()).toHaveLength(1)
  })

  it("hides cached calendar data when a mutation discovers revoked access", async () => {
    fetchMock.mockImplementation(async (_, options) => options?.method === "POST" ? response(null, 403, "MTM_ATTENDANCE_ADMIN_REQUIRED") : response(data()))
    await render()
    await edit("name", "Company day")
    await submit()
    expect(container.querySelector("form")).toBeNull()
    expect(container.querySelectorAll('[data-testid="attendance-calendar-day"]')).toHaveLength(0)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("en").mtmAttendance.calendarAccessUnavailable)
  })

  it("recovers from load failure without exposing raw server text", async () => {
    fetchMock.mockResolvedValueOnce(response(null, 500)).mockResolvedValueOnce(response(data()))
    await render()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(messages("en").mtmAttendance.calendarLoadError)
    expect(container.textContent).not.toContain("PRIVATE_SERVER_ERROR")
    await click("Refresh calendar")
    expect(input("date").value).toBe("2026-10-14")
  })

  // Owner, 2026-11-01 («Давай» to the mockup): next year's calendar read from report.az waits for the admin.
  describe("the calendar found by the watch", () => {
    const found = { year: 2027, state: "FOUND", checkedAt: "2026-12-06T06:00:00.000Z", fingerprint: "0123456789abcdef01234567",
      decision: "Nazirlər Kabinetinin 05.12.2026 tarixli 401 nömrəli qərarı", sourceUrl: "https://report.az/sosial-mudafie/x", publishedOn: "2026-12-06",
      entries: [{ date: "2027-01-01", kind: "PUBLIC_HOLIDAY", name: "Yeni il bayramı" }, { date: "2027-01-02", kind: "PUBLIC_HOLIDAY", name: "Yeni il bayramı" },
        { date: "2027-03-10", kind: "PUBLIC_HOLIDAY", name: "Ramazan bayramı" }, { date: "2027-03-12", kind: "WEEKEND", name: "Köçürülmüş istirahət günü" }] }
    const route = (view: unknown, onPost?: (body: unknown) => Response) => fetchMock.mockImplementation(async (url, options) => {
      const target = String(url)
      if (target.startsWith(`${ENDPOINT}/official?year=`)) return response(target.endsWith("2027") ? view : { year: 2026, state: "DECIDED", source: "x" })
      if (target === `${ENDPOINT}/official` && onPost) return onPost(JSON.parse(String(options!.body)))
      return response(data())
    })

    it("shows the found days with their source, adds exactly the reviewed list, and can dismiss it", async () => {
      const posts: unknown[] = []
      route(found, (body) => { posts.push(body); return response((body as { dismiss?: boolean }).dismiss ? { dismissed: true } : { year: 2027, added: 4, existing: 0, past: 0, complete: true, source: "x" }) })
      await render("az")
      const az = messages("az").mtmAttendance
      await edit("year", "2027")
      const block = container.querySelector('[data-testid="attendance-calendar-found"]')!
      expect(block.textContent).toContain(az.calendarFoundTitle.replace("{year}", "2027"))
      expect(block.textContent).toContain("401 nömrəli")
      expect(block.querySelector("a")!.getAttribute("href")).toBe("https://report.az/sosial-mudafie/x")
      expect(block.querySelectorAll('[data-testid="attendance-calendar-found-day"]')).toHaveLength(3)
      await click(az.calendarFoundShowAll)
      expect(container.querySelectorAll('[data-testid="attendance-calendar-found-day"]')).toHaveLength(4)
      expect(container.querySelector('[data-testid="attendance-calendar-official"]')).toBeNull()
      await click(az.calendarFoundAdd)
      expect(posts.at(-1)).toEqual({ year: 2027, fingerprint: found.fingerprint })
      await click(az.calendarFoundDismiss)
      expect(posts.at(-1)).toEqual({ year: 2027, fingerprint: found.fingerprint, dismiss: true })
    })

    it("reloads instead of adding when the source changed after the admin looked", async () => {
      route(found, () => response(null, 409, "MTM_ATTENDANCE_CALENDAR_FOUND_CHANGED"))
      await render("ru")
      await edit("year", "2027")
      await click(messages("ru").mtmAttendance.calendarFoundAdd)
      expect(container.querySelector('[role="alert"]')!.textContent).toBe(messages("ru").mtmAttendance.calendarFoundChanged)
    })

    it.each([
      ["NOT_YET", { year: 2027, state: "NOT_YET", checkedAt: "2026-12-02T05:00:00.000Z" }, "calendarNotYet"],
      ["UNREADABLE", { year: 2027, state: "UNREADABLE", checkedAt: null, sourceUrl: "https://report.az/a" }, "calendarUnreadable"],
      ["DISMISSED", { year: 2027, state: "DISMISSED", checkedAt: null }, "calendarFoundDismissed"],
    ])("%s: says so under the fixed-holidays button, which still works", async (_state, view, key) => {
      route(view)
      await render("en")
      const en = messages("en").mtmAttendance
      await edit("year", "2027")
      const line = container.querySelector('[data-testid="attendance-calendar-watch"]')!
      expect(line.textContent).toContain(en[key].replace("{year}", "2027"))
      expect(container.querySelector('[data-testid="attendance-calendar-found"]')).toBeNull()
      expect(button(en.calendarOfficialAdd.replace("{year}", "2027"))).toBeTruthy()
      if (key === "calendarNotYet") expect(line.textContent).toContain(en.calendarLastChecked.replace("{time}", ""))
    })
  })
})
