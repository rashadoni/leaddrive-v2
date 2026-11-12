"use client"

/**
 * The two nouns this organisation books by, for every meetings screen.
 *
 * Read once, here, and shared: a salon says «Usta» and a coworking says
 * nothing at all, and six panels asking the server the same question would
 * each answer it at a different moment — the heading would say «Otaqlar» a
 * second before the list below it still said «Xidmətlər».
 *
 * The words themselves are src/lib/booking/vocabulary.ts. What this adds is
 * the fallback: an organisation that has set nothing reads its own
 * translation, exactly as before the setting existed.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { OPEN_VOCABULARY, type BookingVocabulary } from "@/lib/booking/vocabulary"

interface BookingWords {
  /** What is booked — «Xidmət», «Otaq», «Qəbul». Never empty. */
  item: string
  /** Who does it, or null when nobody does: then the row is not drawn at all. */
  host: string | null
  /** What is stored, for the screen that edits it. */
  vocabulary: BookingVocabulary
  setVocabulary: (next: BookingVocabulary) => void
}

const Context = createContext<BookingWords | null>(null)

export function BookingWordsProvider({ children }: { children: ReactNode }) {
  const [vocabulary, setVocabulary] = useState<BookingVocabulary>(OPEN_VOCABULARY)

  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/v1/booking-pages/vocabulary", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => { if (body?.success && !controller.signal.aborted) setVocabulary(body.data.vocabulary) })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

  return <Context.Provider value={useWordsValue(vocabulary, setVocabulary)}>{children}</Context.Provider>
}

function useWordsValue(vocabulary: BookingVocabulary, setVocabulary: (next: BookingVocabulary) => void): BookingWords {
  const t = useTranslations("booking")
  const fallbackItem = t("stepService")
  const fallbackHost = t("colHosts")
  return useMemo(() => ({
    item: vocabulary.item ?? fallbackItem,
    host: vocabulary.noHost ? null : vocabulary.host ?? fallbackHost,
    vocabulary,
    setVocabulary,
  }), [vocabulary, setVocabulary, fallbackItem, fallbackHost])
}

/**
 * The organisation's words, or its translation when it has set none. Safe
 * outside the provider — a panel rendered on its own reads the defaults
 * rather than crashing.
 */
export function useBookingWords(): BookingWords {
  const value = useContext(Context)
  const fallback = useWordsValue(OPEN_VOCABULARY, () => undefined)
  return value ?? fallback
}
