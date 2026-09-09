"use client"

/**
 * Prominent AI search bar rendered at the TOP of the content area on every
 * dashboard page (mounted once in (dashboard)/layout.tsx, above the page body).
 *
 * Submitting (Enter or the search button) dispatches the "davinci:open" window
 * event — the Da Vinci panel (ai-assistant-panel.tsx) opens and runs the
 * tenant- + module-gated read tools, rendering a result table.
 *
 * Max-prominence variant: a SOLID brand-orange (`primary`) plate with a white
 * sparkle AI badge, a white input field punched into it, and a white search
 * button (orange text).
 *
 * The placeholder ROTATES through varied smart-query examples (random, every
 * few seconds, paused while focused/typing) so users gradually learn this is a
 * natural-language search with filters/dates/status — not a plain keyword box.
 * Examples are kept per-locale in-component (same pattern as ai-assistant-panel's
 * UI_TEXT) rather than i18n, since they're a tunable showcase list.
 */
import { useEffect, useState } from "react"
import { Search, Sparkles } from "lucide-react"
import { useTranslations, useLocale } from "next-intl"

const HINTS: Record<string, { prefix: string; items: string[] }> = {
  en: {
    prefix: "Ask AI —",
    items: [
      "deals over $5,000",
      "VIP contacts",
      "tasks due this week",
      "open tickets by priority",
      "deals in negotiation, last 30 days",
    ],
  },
  ru: {
    prefix: "Спросите ИИ —",
    items: [
      "сделки дороже 5000",
      "VIP-контакты",
      "задачи на эту неделю",
      "открытые тикеты по приоритету",
      "сделки в переговорах за 30 дней",
    ],
  },
  az: {
    prefix: "AI-dan soruşun —",
    items: [
      "5000-dən yuxarı sövdələşmələr",
      "VIP kontaktlar",
      "bu həftənin tapşırıqları",
      "prioritetə görə açıq biletlər",
      "son 30 gündə danışıqlarda olan sövdələşmələr",
    ],
  },
}

const ROTATE_MS = 3500

export function ContentSearchBar() {
  const t = useTranslations("common")
  const locale = useLocale()
  const hints = HINTS[locale] ?? HINTS.en

  const [q, setQ] = useState("")
  const [focused, setFocused] = useState(false)
  // Deterministic first render (index 0) to avoid SSR/client hydration mismatch;
  // randomization only happens client-side in the interval below.
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    // Pause rotation while the user is focused or has typed something.
    if (focused || q || hints.items.length <= 1) return
    const id = setInterval(() => {
      setIdx((cur) => {
        let next = cur
        while (next === cur) next = Math.floor(Math.random() * hints.items.length)
        return next
      })
    }, ROTATE_MS)
    return () => clearInterval(id)
  }, [focused, q, hints.items.length])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const query = q.trim()
    if (!query) return
    window.dispatchEvent(new CustomEvent("davinci:open", { detail: { query } }))
    setQ("")
  }

  return (
    <form
      onSubmit={submit}
      className="ai-search-bar mb-6 flex w-full items-center gap-3 rounded-2xl bg-primary p-3 pl-4 shadow-lg shadow-primary/35"
    >
      <Sparkles className="h-6 w-6 shrink-0 text-primary-foreground" aria-hidden="true" />
      {/* SOLID white field punched into the orange plate. Explicit bg-white +
          dark text (NOT theme tokens) so it stays a bright, obviously-writable
          field on every page — incl. the dashboard's dark glassmorphism over the
          live wallpaper, where bg-background/text-foreground go dark and blend. */}
      <div className="ai-search-field flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-white">
        <Search className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={`${hints.prefix} «${hints.items[idx]}»`}
          aria-label={t("aiSearch")}
          className="ai-search-input min-w-0 flex-1 bg-transparent text-base font-medium text-zinc-900 placeholder:font-normal placeholder:text-zinc-500 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        aria-label={t("aiSearch")}
        className="ai-search-btn flex shrink-0 items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-primary shadow-sm transition-all hover:bg-zinc-50 active:scale-[0.98]"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t("aiSearch")}</span>
      </button>
      {/* The global VoiceOrb portals its control here on dense MTM pages.
          The host collapses completely for users outside the voice pilot. */}
      <div
        id="dashboard-voice-assistant-slot"
        className="flex h-11 w-11 shrink-0 items-center justify-center empty:hidden"
      />
    </form>
  )
}
