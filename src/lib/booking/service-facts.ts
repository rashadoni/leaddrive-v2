/**
 * What the company offers, in a form the answering AI can read.
 *
 * The salon's services, their prices, how long they take and where they
 * happen are already in `booking_pages` — the owner typed them once when
 * making the booking link. But the assistant that answers «how much is a
 * haircut» knew nothing about them: the booking agent acts only on a request
 * for a time and hands everything else on (`not_booking`), and the general
 * reply reads only the knowledge base, which in most organisations is empty.
 * So the one question customers ask before any other got no answer from a
 * product that had it written down.
 *
 * This is facts, not freedom. The block carries what the organisation itself
 * saved and nothing derived: no free times, no promises, no arithmetic. The
 * assistant is told plainly that it may not name a time — the booking agent
 * owns that, and it is the only thing that can see the schedule.
 */
import { bookingDb as prisma } from "./db"
import { servicePriceLabel } from "./service"
import type { Locale } from "@/i18n/routing"

/** More than this and the prompt stops being about this customer's question. */
const MAX_SERVICES = 12
/** Enough for a dozen services; a prompt is not a catalogue. */
const MAX_CHARS = 1200

const LOCATION: Record<string, Record<string, string>> = {
  az: { office: "ofisdə", phone: "telefonla", online: "onlayn" },
  ru: { office: "в офисе", phone: "по телефону", online: "онлайн" },
  en: { office: "at the office", phone: "by phone", online: "online" },
}

const HEADING: Record<string, string> = {
  az: "ŞİRKƏTİN XİDMƏTLƏRİ (yalnız fakt — vaxt təyin etmə)",
  ru: "УСЛУГИ КОМПАНИИ (только факты — время не назначай)",
  en: "THE COMPANY'S SERVICES (facts only — do not name a time)",
}

const RULE: Record<string, string> = {
  az: "Qiymət və müddət barədə yalnız bu siyahıdan cavab ver. Boş vaxtı sən bilmirsən: müştəri yazılmaq istəsə, uyğun vaxtları təklif edəcəyini de və onun cavabını gözlə.",
  ru: "О цене и длительности отвечай только по этому списку. Свободное время тебе неизвестно: если клиент хочет записаться, скажи, что предложишь подходящее время, и дождись его ответа.",
  en: "Answer about price and duration only from this list. You do not know the free times: if the customer wants to book, say you will offer suitable times and wait for their reply.",
}

function minutes(value: number, language: string): string {
  if (language === "az") return `${value} dəq`
  if (language === "ru") return `${value} мин`
  return `${value} min`
}

/**
 * The services block for the system prompt, or an empty string when the
 * organisation has none published — a company that does not take bookings
 * should not get a heading with nothing under it.
 */
export async function serviceFactsBlock(orgId: string, language: string): Promise<string> {
  const locale = (["az", "ru", "en"].includes(language) ? language : "az") as Locale
  const pages = await prisma.bookingPage.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { title: true, durationMinutes: true, price: true, priceCurrency: true, locationType: true, locationText: true, description: true },
    orderBy: { createdAt: "asc" },
    take: MAX_SERVICES,
  }).catch(() => [])
  if (pages.length === 0) return ""

  const lines: string[] = []
  for (const page of pages) {
    const price = servicePriceLabel({ price: page.price === null ? null : String(page.price), priceCurrency: page.priceCurrency }, locale)
    const place = LOCATION[locale]?.[page.locationType] ?? null
    const parts = [minutes(page.durationMinutes, locale), price, place].filter(Boolean)
    // The location text is the salon's own address; it answers «where are you»,
    // which is the second question after the price.
    const where = page.locationText?.trim()
    const line = `- ${page.title}: ${parts.join(", ")}${where ? ` (${where.slice(0, 80)})` : ""}`
    if (lines.join("\n").length + line.length > MAX_CHARS) break
    lines.push(line)
  }
  if (lines.length === 0) return ""
  return `\n\n${HEADING[locale] ?? HEADING.az}:\n${lines.join("\n")}\n${RULE[locale] ?? RULE.az}`
}
