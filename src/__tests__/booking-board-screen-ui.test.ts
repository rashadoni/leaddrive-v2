/**
 * The wall screen, as a room reads it.
 *
 * The owner stood at the salon's monitor on 2026-11-13 with a booking he knew
 * existed and saw four empty columns and one thin orange line — the mark for
 * «now», which he took for the booking itself: «тонкая линия… нам не подходит,
 * там должна быть информация подробная, шрифтом таким, который будет виден на
 * телевизоре». And the date on the screen read «M11 13, Fri».
 *
 * So what is checked is what somebody across the room can read off it: each
 * visit with its time, its client, its service and how long it lasts; which
 * one is in the chair and how soon the next one is; an empty screen that says
 * whose day it is showing; and that nothing on it is sized in pixels a
 * television would shrink to a hairline.
 */
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { BoardScreen } from "@/components/booking/board-screen"
import type { Board, BoardMeeting } from "@/lib/booking/board-view"

const min = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3))
const meeting = (id: string, hostId: string, from: string, to: string, name: string, service: string): BoardMeeting => ({ id, hostId, start: min(from), end: min(to), name, service })
const day = { title: "ZAL1", day: "2026-11-13", timezone: "Asia/Baku", from: 480, to: 1260 }

const salon: Board = { ...day, columns: 2, hosts: [
  { hostId: "a", hostName: "Aysel Quliyeva", meetings: [
    meeting("past", "a", "09:00", "09:45", "Nərmin", "Manikür"),
    meeting("now", "a", "10:00", "10:45", "Leyla Məmmədova", "Manikür"),
    meeting("next", "a", "11:30", "12:30", "Günay Əliyeva", "Kirpik"),
  ] },
  { hostId: "b", hostName: "Elnur Babayev", meetings: [meeting("soon", "b", "10:40", "11:10", "Rəşad Rəhimov", "Saç kəsimi")] },
  { hostId: "c", hostName: "Aysu Kərimli", meetings: [] },
] }

const draw = (board: Board, at: string, over: { page?: number; staleSince?: string | null } = {}) =>
  renderToStaticMarkup(createElement(BoardScreen, { board, nowMinutes: min(at), page: over.page ?? 0, staleSince: over.staleSince }))
/** The text of one visit's card, tags gone. */
const card = (markup: string, phase: string) => [...markup.matchAll(new RegExp(`<li data-phase="${phase}"[^>]*>(.*?)</li>`, "g"))].map((match) => match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())

describe("the wall screen", () => {
  it("writes every visit out: its time, its client, its service and how long", () => {
    const markup = draw(salon, "10:23")

    expect(card(markup, "now")).toEqual(["10:00 – 10:45 İndi Leyla Məmmədova Manikür · 45 dəq"])
    expect(card(markup, "next")).toEqual([
      "11:30 – 12:30 1 saat 7 dəq sonra Günay Əliyeva Kirpik · 1 saat",
      "10:40 – 11:10 17 dəq sonra Rəşad Rəhimov Saç kəsimi · 30 dəq",
    ])
    // What is over is not on the wall.
    expect(markup).not.toContain("Nərmin")
  })

  it("says which chair is taken and which is free, and the time on the wall", () => {
    const markup = draw(salon, "10:23").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

    expect(markup).toContain("Aysel Quliyeva Məşğuldur")
    expect(markup).toContain("Elnur Babayev Boşdur")
    expect(markup).toContain("10:23")
    // The day in Azerbaijani, from our own words — not from the browser's Intl.
    expect(markup).toContain("13 noyabr, cümə")
    expect(markup).not.toMatch(/M11|Fri/)
  })

  it("names the masters with nothing left in one line, not in an empty column", () => {
    const markup = draw(salon, "10:23")

    expect(markup).toContain("Bu gün başqa görüşü yoxdur: Aysu Kərimli")
    expect(markup.match(/<section/g)).toHaveLength(2)
  })

  it("an empty screen says so in words, and whose day it is showing", () => {
    // The photograph: four chosen masters, none of them with a visit, and a
    // booking with a fifth. An empty wall must not read as «the salon is empty».
    const narrowed: Board = { ...day, columns: 2, hosts: ["Aysel Quliyeva", "Aysu Kərimli", "Aytən Rəhimli", "Elnur Babayev"].map((name) => ({ hostId: name, hostName: name, meetings: [] })) }
    const markup = draw(narrowed, "10:23")

    expect(markup).toContain("Bu gün görüş yoxdur")
    expect(markup).toContain("Bu ekranda: Aysel Quliyeva · Aysu Kərimli · Aytən Rəhimli · Elnur Babayev")
    expect(markup).not.toContain("<section")
  })

  it("after the last visit it says the day is done, not that there was none", () => {
    const over: Board = { ...day, columns: 2, hosts: [{ hostId: "a", hostName: "Aysel", meetings: [meeting("m", "a", "09:00", "09:30", "Nərmin", "Manikür")] }] }

    expect(draw(over, "18:00")).toContain("Bu günün görüşləri bitdi")
  })

  it("takes turns when there are more columns than the screen holds, and says which turn it is", () => {
    const four: Board = { ...day, columns: 2, hosts: ["a", "b", "c"].map((id) => ({ hostId: id, hostName: `Usta ${id}`, meetings: [meeting(id, id, "12:00", "12:30", `Müştəri ${id}`, "Saç kəsimi")] })) }

    const first = draw(four, "10:23", { page: 0 })
    const second = draw(four, "10:23", { page: 1 })
    expect(first).toContain("Usta a")
    expect(first).not.toContain("Usta c")
    expect(first.replace(/<[^>]+>/g, "")).toContain("1 / 2")
    expect(second).toContain("Usta c")
    expect(second.replace(/<[^>]+>/g, "")).toContain("2 / 2")
    // A turn that no longer exists (a column emptied meanwhile) shows the last one, not nothing.
    expect(draw(four, "10:23", { page: 7 })).toContain("Usta c")
  })

  it("a column alone gets the width of the screen: one row per visit", () => {
    const one: Board = { ...day, columns: 2, hosts: [{ hostId: "l", hostName: "Leyla", meetings: [meeting("m", "l", "10:00", "10:30", "Rəşad Rəhimov", "Saç kəsimi")] }] }
    const markup = draw(one, "10:23")

    expect(markup).toContain("grid-template-columns:auto minmax(0, 1fr) auto")
    expect(card(markup, "now")).toEqual(["10:00 – 10:30 Rəşad Rəhimov Saç kəsimi · 30 dəq İndi"])
  })

  it("says when it has lost the server instead of showing an old day as today's", () => {
    const markup = draw(salon, "10:23", { staleSince: "10:21" })

    expect(markup).toContain("Əlaqə yoxdur · son yenilənmə 10:21")
    expect(markup).toContain('role="status"')
  })

  it("is sized by the screen it hangs on, never in pixels", () => {
    // A television is not a window: a 14-pixel label or a one-pixel border is
    // what turned a visit into a thin line. Every size here is a share of the
    // screen's height, capped by its width.
    const markup = draw(salon, "10:23")
    const sizes = [...markup.matchAll(/font-size:([^;"]+)/g)].map((match) => match[1])

    expect(sizes.length).toBeGreaterThan(10)
    expect(sizes.every((size) => /^min\([\d.]+vh, [\d.]+vw\)$/.test(size))).toBe(true)
    // Nothing a person must read is smaller than a fortieth of the screen's height.
    expect(Math.min(...sizes.map((size) => Number(size.slice(4, size.indexOf("vh")))))).toBeGreaterThanOrEqual(2.3)
    expect(markup).not.toMatch(/text-(xs|sm|base|lg|xl|\dxl)\b/)
  })
})
