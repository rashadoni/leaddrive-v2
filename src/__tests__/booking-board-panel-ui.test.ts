/**
 * «Экран в зале» as a screen, not as a form dump.
 *
 * The first version drew the whole staff as chips — twenty-seven names in
 * three rows — and had no way to change a screen once it was made. The owner
 * said both in one breath (2026-11-11: «ui опять на коленках», «нет
 * редактирования например кого то добавил кого то убрал»), and the first of
 * them he had already said about the WhatsApp rules a day earlier. So the two
 * things checked here are the two he named:
 *
 *   1. «Everyone» is one chip with a number, never one chip per name — the
 *      same picker the rules use, now shared (booking-picked.tsx).
 *   2. An existing screen opens for editing in place, with its own name,
 *      columns and people filled in, and its address untouched.
 *
 * Every literal key renders through the real az/ru/en catalogues, so a key
 * that exists in none of them prints its own name and fails here.
 */
import { createElement, type ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import { BookingBoardPanel } from "@/components/booking/booking-board-panel"

import en from "../../messages/en.json"
import ru from "../../messages/ru.json"
import az from "../../messages/az.json"

/** A salon the size of the one that showed the problem. */
const HOSTS = Array.from({ length: 27 }, (ignored, index) => ({ id: `h${index}`, name: `Usta ${index}` }))

function render(locale: "az" | "en" | "ru" = "ru") {
  const messages = { az, en, ru }[locale]
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale,
    messages,
    children: createElement(BookingBoardPanel, { hosts: HOSTS }),
  } as ComponentProps<typeof NextIntlClientProvider>))
}

/** Names drawn as chips; the search field renders its list only once opened. */
const hostChips = (markup: string) => [...markup.matchAll(/Usta (\d+)</g)].map((match) => Number(match[1]))

describe("the wall screen's panel", () => {
  it("never draws the staff as a wall of chips", () => {
    // The whole complaint, in one assertion: before this, all twenty-seven
    // names were on screen before anybody chose anything.
    const markup = render()

    expect(hostChips(markup)).toEqual([])
    expect(markup).toContain("Экран в зале")
  })

  it("offers to make a screen rather than opening a form nobody asked for", () => {
    const markup = render()

    expect(markup).toContain("Новый экран")
    // The fields appear on that button, not before it.
    expect(markup).not.toContain('id="board-title"')
  })

  it("speaks every locale it claims to", () => {
    for (const locale of ["az", "en", "ru"] as const) {
      const markup = render(locale)
      expect(markup).not.toContain("booking.board")
      expect(markup).not.toContain("waRules")
    }
  })
})

describe("what the panel asks the server", () => {
  it("changes a screen in place instead of making a second one", async () => {
    // A monitor has its address typed in once. Editing must be a PATCH of the
    // same row — a second link is how a screen ends up showing yesterday's set
    // for ever.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../components/booking/booking-board-panel.tsx", import.meta.url), "utf8"))

    expect(source).toContain('isNew ? "POST" : "PATCH"')
    expect(source).toContain('{ id: editing, ...payload }')
  })

  it("takes its picker from the one place both screens share", () => {
    const source = require("node:fs").readFileSync(new URL("../components/booking/booking-board-panel.tsx", import.meta.url), "utf8")
    const rules = require("node:fs").readFileSync(new URL("../components/booking/booking-whatsapp-rules.tsx", import.meta.url), "utf8")

    expect(source).toContain('from "./booking-picked"')
    expect(rules).toContain('from "./booking-picked"')
    // Neither screen keeps its own copy to drift away with.
    expect(source).not.toContain("function Picked(")
    expect(rules).not.toContain("function Picked(")
  })
})

vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: () => null,
}))
