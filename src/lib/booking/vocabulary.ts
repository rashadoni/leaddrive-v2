/**
 * What this organisation calls the two things it books.
 *
 * The module was written for salons, so the screens said «service» and
 * «master» — in the code, in the texts and inside the WhatsApp form. A clinic
 * books a «приём» with a «врач», a coworking books a «комната» with nobody at
 * all, a workshop books a «стол». The owner asked for all three on the same
 * day (2026-11-12: «завтра какой-то клиент захочет просто бронировать комнаты
 * для встреч… или кто-то будет не услуги, а что-то другое хотеть»).
 *
 * So the two nouns are a setting, not a translation. Two rules keep it from
 * becoming a second translation system nobody maintains:
 *
 *   1. **Only where the word stands alone as a label.** «Xidmət», «Ustalar»,
 *      «Yeni xidmət» — those become the organisation's words. Sentences and
 *      hints keep the plain wording: a setting cannot decline a noun, and a
 *      half-declined sentence reads worse than a general one.
 *   2. **Nothing is translated here.** A word the organisation typed is its
 *      own in every locale — nobody writes «Otaq» three times — and when it
 *      has typed nothing, the screen falls back to its own translation.
 */

/** Key in `organizations.settings`. */
export const BOOKING_VOCABULARY_SETTING = "bookingVocabulary"

export interface BookingVocabulary {
  /** What is booked: service, room, appointment, table. Null = the default. */
  item: string | null
  /** Who or what does it: master, doctor, hall. Null = the default. */
  host: string | null
  /**
   * There is nobody on the other side at all — a room books itself. The whole
   * row disappears: on the screens, in the WhatsApp message and in the form.
   */
  noHost: boolean
}

export const OPEN_VOCABULARY: BookingVocabulary = { item: null, host: null, noHost: false }

/** A word as the setting may hold it: trimmed, bounded, never empty. */
function word(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim().replace(/\s+/g, " ")
  // Thirty is what a dropdown label and a WhatsApp row both hold.
  return trimmed ? trimmed.slice(0, 30) : null
}

export function readBookingVocabulary(settings: unknown): BookingVocabulary {
  const raw = settings && typeof settings === "object" ? (settings as Record<string, unknown>)[BOOKING_VOCABULARY_SETTING] : null
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const noHost = value.noHost === true
  return {
    item: word(value.item),
    // «Nobody does it» and «they are called this» cannot both be true: the
    // screens read one field, and a name for a row that is hidden is a trap
    // for whoever reads the setting next.
    host: noHost ? null : word(value.host),
    noHost,
  }
}

/**
 * The ready-made pairs the settings screen offers.
 *
 * Not a list of industries — a list of WORDS, because the point is that the
 * owner sees their own business named in one tap and never has to think about
 * what the field means. `id` is ours; the words are per locale, and an
 * organisation that picks one simply gets those words written into its
 * setting, after which they are its own.
 */
export const BOOKING_VOCABULARY_PRESETS: {
  id: string
  noHost?: boolean
  words: Record<"az" | "ru" | "en", { item: string; host: string | null }>
}[] = [
  {
    id: "salon",
    words: {
      az: { item: "Xidmət", host: "Usta" },
      ru: { item: "Услуга", host: "Мастер" },
      en: { item: "Service", host: "Specialist" },
    },
  },
  {
    id: "clinic",
    words: {
      az: { item: "Qəbul", host: "Həkim" },
      ru: { item: "Приём", host: "Врач" },
      en: { item: "Appointment", host: "Doctor" },
    },
  },
  {
    // A coworking books a meeting IN a room: the room is what the client
    // chooses between, so it is the second word, not the first. «Nobody on
    // the other side» is the checkbox beside the fields, for the rarer case
    // where there is nothing to choose at all.
    id: "rooms",
    words: {
      az: { item: "Toplantı", host: "Otaq" },
      ru: { item: "Встреча", host: "Комната" },
      en: { item: "Meeting", host: "Room" },
    },
  },
  {
    id: "equipment",
    words: {
      az: { item: "Avadanlıq", host: "Stol" },
      ru: { item: "Оборудование", host: "Стол" },
      en: { item: "Equipment", host: "Station" },
    },
  },
  {
    id: "lesson",
    words: {
      az: { item: "Dərs", host: "Müəllim" },
      ru: { item: "Занятие", host: "Преподаватель" },
      en: { item: "Class", host: "Teacher" },
    },
  },
]

/** The preset an organisation's own words match, if any — for the screen. */
export function matchingPreset(vocabulary: BookingVocabulary, locale: "az" | "ru" | "en"): string | null {
  return BOOKING_VOCABULARY_PRESETS.find((preset) => {
    const words = preset.words[locale]
    return words.item === vocabulary.item && (words.host ?? null) === vocabulary.host && Boolean(preset.noHost) === vocabulary.noHost
  })?.id ?? null
}
