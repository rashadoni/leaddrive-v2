/**
 * What the WhatsApp agent may book by itself, as a screen rather than a wall.
 *
 * The owner opened it on a salon with twenty-seven masters and saw twenty-seven
 * orange pills in three rows, under a services list he had to scroll past to
 * reach them at all (2026-11-10: «не красиво, дилетантно… никто не скролит»).
 * The pills also told him nothing: every one of them was on, because the rule
 * was «everyone». So two things are checked here, and both are about what is
 * on screen, not how it is built:
 *
 *   1. «Everything» is one chip with a number, never one chip per name. The
 *      moment a salon narrows the list, the chosen ones appear as chips and
 *      the rest hide behind one search field — the same shape the day view
 *      settled on (booking-day-timeline).
 *   2. Rules at their defaults take one line. A salon that narrowed something
 *      sees it opened, because that is the salon with something to check.
 *
 * Every literal key is rendered through the real az/en/ru catalogues, so a key
 * that exists in none of them prints its own name and fails here.
 */
import { createElement, type ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { NextIntlClientProvider } from "next-intl"
import { describe, expect, it } from "vitest"
import { BookingWhatsAppRules } from "@/components/booking/booking-whatsapp-rules"
import type { AutonomyRules } from "@/lib/booking/whatsapp-rules"

import en from "../../messages/en.json"
import ru from "../../messages/ru.json"
import az from "../../messages/az.json"

const SERVICES = [
  { id: "s1", title: "Saç kəsimi" },
  { id: "s2", title: "Saç boyama" },
  { id: "s3", title: "Manikür" },
]

/** A salon the size of the one that showed the problem. */
const HOSTS = Array.from({ length: 27 }, (ignored, index) => ({ id: `h${index}`, name: `Usta ${index}` }))

const ALL: AutonomyRules = { serviceIds: null, hostIds: null, hours: null, maxPrice: null, newClients: true }

function render(rules: AutonomyRules, options: { locale?: "az" | "en" | "ru"; open?: boolean } = {}) {
  const locale = options.locale ?? "ru"
  const messages = { az, en, ru }[locale]
  return renderToStaticMarkup(createElement(NextIntlClientProvider, {
    locale,
    messages,
    children: createElement(BookingWhatsAppRules, {
      rules,
      services: SERVICES,
      hosts: HOSTS,
      disabled: false,
      defaultOpen: options.open ?? true,
      onChange: () => {},
    }),
  } as ComponentProps<typeof NextIntlClientProvider>))
}

/** Names drawn as chips; the search field renders its list only once opened. */
const hostChips = (markup: string) => [...markup.matchAll(/Usta (\d+)</g)].map((match) => Number(match[1]))

describe("the WhatsApp agent's rules on screen", () => {
  it("says «everyone» with a count instead of twenty-seven chips", () => {
    const markup = render(ALL)

    expect(hostChips(markup)).toEqual([])
    expect(markup).toContain("Все · 27")
    expect(markup).toContain("Все · 3")
  })

  it("shows the chosen ones as chips and keeps the rest behind one field", () => {
    const markup = render({ ...ALL, hostIds: ["h0", "h4"] })

    expect(hostChips(markup)).toEqual([0, 4])
    expect(markup).toContain("Добавить ещё 25")
  })

  it("reads the whole rule set as one line above the fold", () => {
    const narrowed = render({ ...ALL, serviceIds: ["s1"], hostIds: ["h0"], maxPrice: 50, newClients: false })

    expect(narrowed).toContain("услуг: 1")
    expect(narrowed).toContain("мастеров: 1")
    expect(narrowed).toContain("до 50")
    expect(narrowed).toContain("новые клиенты — нет")
    expect(narrowed).toContain("любое время")
  })

  it("keeps the default rules folded into that line and nothing else", () => {
    const folded = render(ALL, { open: false })

    // The summary is there, the controls are not: an untouched salon gets one
    // row, not a form it never filled.
    expect(folded).toContain("все мастера")
    expect(folded).not.toContain("Добавить ещё")
    expect(folded).not.toContain('type="time"')
    expect(folded).toContain('aria-expanded="false"')
  })

  it("draws the week as short labels in every locale, not a key", () => {
    for (const locale of ["az", "en", "ru"] as const) {
      const markup = render({ ...ALL, hours: null }, { locale })
      expect(markup).not.toContain("booking.weekdayShort")
      expect(markup).not.toContain("waRules")
    }
  })
})
