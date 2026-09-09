/**
 * Лёгкий детектор языка веб-статей (Google Alerts RSS, поиск по новостям).
 *
 * AI-триаж (ai-triage.ts) структурно не запускается для платформы `web` —
 * его allowlist охватывает только соцсети, поэтому web-находки оставались без
 * sourceMetadata.socialTriage.language, и строгий языковой фильтр ленты
 * (mentions/route.ts, дефолт «Azərbaycan dili») прятал их все до единой.
 *
 * Рынок тенантов — Азербайджан: трёх языков достаточно. Порядок проверок
 * важен: кириллица однозначно отделяет русский (современный азербайджанский —
 * латиница), «ə» и частотные азербайджанские слова — самый надёжный сигнал az.
 * При неуверенности возвращаем null: честное «неизвестно» лучше ложной метки.
 */

const CYRILLIC = /[а-яА-ЯёЁ]/
// «ə» уникальна для азербайджанского и является самой частой буквой языка —
// в реальном заголовке+сниппете встречается практически всегда.
const AZ_UNIQUE = /[əƏ]/
// Частотные служебные слова — ловят диакритико-бедные короткие заголовки.
const AZ_WORDS = /(?:^|[^a-zA-ZəƏğışçöüĞİŞÇÖÜ])(və|üçün|ilə|olan|edir|edib|bildirib|deyib|Azərbaycan)(?=$|[^a-zA-ZəƏğışçöüĞİŞÇÖÜ])/i
// Турецко-азербайджанские диакритики без «ə» — слабый, но полезный сигнал az
// (турецкие новости в азербайджанских алертах — редкость).
const AZ_HINT = /[ğışĞİŞ]/
const EN_WORDS = /\b(the|and|for|with|from|has|was|will)\b/i

export type ArticleLanguage = "az" | "ru" | "en"

export function detectArticleLanguage(text: string | null | undefined): ArticleLanguage | null {
  const sample = (text ?? "").slice(0, 2000)
  if (!sample.trim()) return null
  if (CYRILLIC.test(sample)) return "ru"
  if (AZ_UNIQUE.test(sample) || AZ_WORDS.test(sample) || AZ_HINT.test(sample)) return "az"
  if (EN_WORDS.test(sample)) return "en"
  return null
}
