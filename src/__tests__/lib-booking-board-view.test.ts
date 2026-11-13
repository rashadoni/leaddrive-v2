/**
 * The day, as a wall shows it.
 *
 * The first screen drew a calendar: hours down the side and a meeting as tall
 * as it is long. A half-hour visit became a strip nobody could read from the
 * door, and an empty hour looked like a broken screen (owner, 2026-11-13,
 * photographing the monitor: «тонкая линия… нам не подходит, там должна быть
 * информация подробная, шрифтом таким, который будет виден на телевизоре»).
 *
 * So the arithmetic checked here is the arithmetic of a GLANCE: who is in the
 * chair now, who is next and in how long, which chairs have nothing left — and
 * that what already happened is not on the wall at all.
 */
import { describe, expect, it } from "vitest"
import { BOARD_FIT, boardClock, boardDayLabel, boardLasts, boardLayout, boardStartsIn, releaseToLoad, screenOf, type Board, type BoardMeeting } from "@/lib/booking/board-view"

const min = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3))
const meeting = (id: string, hostId: string, from: string, to: string, name = id): BoardMeeting => ({ id, hostId, start: min(from), end: min(to), name, service: "Saç kəsimi" })
const board = (columns: 1 | 2 | 4, hosts: Board["hosts"]): Board => ({ title: "ZAL1", day: "2026-11-13", timezone: "Asia/Baku", columns, from: 480, to: 1260, hosts })

describe("what a wall shows of a day", () => {
  it("drops what is over, marks who is in the chair and who is next", () => {
    const screen = screenOf(board(2, [{ hostId: "a", hostName: "Aysel", meetings: [
      meeting("gone", "a", "09:00", "09:45"),
      meeting("in", "a", "10:00", "10:45"),
      meeting("next", "a", "11:30", "12:30"),
      meeting("after", "a", "13:00", "14:30"),
    ] }]), min("10:23"))

    const [column] = screen.pages[0]
    expect(column.meetings.map((item) => [item.id, item.phase, item.startsIn])).toEqual([
      ["in", "now", 0],
      ["next", "next", 67],
      ["after", "later", 157],
    ])
    expect(column.busy).toBe(true)
    // The one that ended is counted, not drawn: «none left» is not «none today».
    expect(screen.done).toBe(1)
  })

  it("a chair between two visits is free, and its next visit is still named", () => {
    const screen = screenOf(board(2, [{ hostId: "b", hostName: "Elnur", meetings: [meeting("soon", "b", "10:40", "11:10"), meeting("then", "b", "12:00", "12:30")] }]), min("10:23"))

    expect(screen.pages[0][0].busy).toBe(false)
    expect(screen.pages[0][0].meetings.map((item) => item.phase)).toEqual(["next", "later"])
  })

  it("a visit is over at the minute it ends, not a minute later", () => {
    const day = board(1, [{ hostId: "a", hostName: "Aysel", meetings: [meeting("m", "a", "10:00", "10:30")] }])

    expect(screenOf(day, min("10:29")).pages[0][0].meetings.map((item) => item.phase)).toEqual(["now"])
    expect(screenOf(day, min("10:30")).pages).toEqual([])
  })

  it("names the chairs with nothing left in one line instead of an empty column each", () => {
    // The screen the owner photographed: four masters chosen, none of them
    // with a visit — four empty columns taking turns, two at a time.
    const empty = screenOf(board(2, ["Aysel", "Aysu", "Aytən", "Elnur"].map((name) => ({ hostId: name, hostName: name, meetings: [] }))), min("10:23"))

    expect(empty.pages).toEqual([])
    expect(empty.idle.map((item) => item.name)).toEqual(["Aysel", "Aysu", "Aytən", "Elnur"])
    expect(empty.done).toBe(0)
  })

  it("gives the screen to those who have visits, in the order it was set up with", () => {
    const screen = screenOf(board(2, [
      { hostId: "a", hostName: "Aysel", meetings: [] },
      { hostId: "b", hostName: "Leyla", meetings: [meeting("1", "b", "12:00", "12:30")] },
      { hostId: "c", hostName: "Nigar", meetings: [meeting("2", "c", "11:00", "12:00")] },
      { hostId: "d", hostName: "Elnur", meetings: [meeting("3", "d", "15:00", "16:00")] },
    ]), min("10:23"))

    expect(screen.pages.map((page) => page.map((column) => column.name))).toEqual([["Leyla", "Nigar"], ["Elnur"]])
    expect(screen.idle.map((item) => item.name)).toEqual(["Aysel"])
  })

  it("keeps a card readable: the rest of a long day becomes a number", () => {
    const many = Array.from({ length: 7 }, (ignored, index) => meeting(`m${index}`, "a", `${String(11 + index).padStart(2, "0")}:00`, `${String(11 + index).padStart(2, "0")}:45`))
    const two = screenOf(board(2, [{ hostId: "a", hostName: "Aysel", meetings: many }, { hostId: "b", hostName: "Nigar", meetings: [meeting("x", "b", "12:00", "12:30")] }]), min("10:23"))
    const one = screenOf(board(1, [{ hostId: "a", hostName: "Aysel", meetings: many }]), min("10:23"))

    // Side by side they are cards; alone, a column gets the whole width and a row each.
    expect(boardLayout(2)).toBe("stacked")
    expect(boardLayout(1)).toBe("wide")
    expect(two.pages[0][0].meetings).toHaveLength(BOARD_FIT.stacked)
    expect(two.pages[0][0].more).toBe(7 - BOARD_FIT.stacked)
    expect(one.pages[0][0].meetings).toHaveLength(BOARD_FIT.wide)
    expect(one.pages[0][0].more).toBe(7 - BOARD_FIT.wide)
    // What is cut is the far end of the day, never the visit in the chair.
    expect(two.pages[0][0].meetings[0].id).toBe("m0")
  })

  it("a room is a column like a master, and says that it is one", () => {
    const screen = screenOf(board(2, [{ hostId: "r", hostName: "Otaq A", room: true, meetings: [meeting("1", "r", "10:00", "11:00")] }]), min("10:23"))

    expect(screen.pages[0][0]).toMatchObject({ name: "Otaq A", room: true, busy: true })
  })
})

describe("the words on the wall", () => {
  it("writes the day in Azerbaijani itself, whatever the television's browser knows", () => {
    // Chrome on the salon's monitor has no Azerbaijani in Intl; the first
    // screen greeted the room with «M11 13, Fri».
    expect(boardDayLabel("2026-11-13")).toBe("13 noyabr, cümə")
    expect(boardDayLabel("2026-11-17")).toBe("17 noyabr, çərşənbə axşamı")
    expect(boardDayLabel("2027-01-03")).toBe("3 yanvar, bazar")
    expect(boardDayLabel("")).toBe("")
  })

  it("says how long until the next one the way it is said aloud", () => {
    expect(boardStartsIn(17)).toBe("17 dəq sonra")
    expect(boardStartsIn(60)).toBe("1 saat sonra")
    expect(boardStartsIn(67)).toBe("1 saat 7 dəq sonra")
    expect(boardLasts(30)).toBe("30 dəq")
    expect(boardLasts(90)).toBe("1 saat 30 dəq")
    expect(boardClock(9 * 60 + 5)).toBe("09:05")
  })
})

describe("a screen nobody touches, and the next release", () => {
  const OLD = "a".repeat(40)
  const NEW = "b".repeat(40)

  it("loads itself again when the server runs a release that is not its own", () => {
    expect(releaseToLoad(OLD, NEW, null)).toBe(NEW)
  })

  it("stays as it is while the server runs the same release", () => {
    expect(releaseToLoad(OLD, OLD, null)).toBeNull()
  })

  it("does not blink every five minutes when a reload did not help", () => {
    // A cached page or a rollback in between: the tab already tried this release once.
    expect(releaseToLoad(OLD, NEW, NEW)).toBeNull()
    // …but a release after that one is a new reason.
    expect(releaseToLoad(OLD, "c".repeat(40), NEW)).toBe("c".repeat(40))
  })

  it("never reloads on an answer that is not a release, or from a build that has none", () => {
    for (const served of [null, undefined, "", "613312f22a58", 42, { sha: NEW }]) expect(releaseToLoad(OLD, served, null)).toBeNull()
    expect(releaseToLoad("", NEW, null)).toBeNull()
  })
})
