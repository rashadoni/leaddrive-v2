import jsPDF from "jspdf"

import { registerUnicodeFont } from "@/lib/pdf/unicode-font"
import type {
  VisualMonitoringReportItem,
  VisualMonitoringReportSnapshot,
} from "@/lib/social/visual-monitoring-report"
import type { VisualReportSection } from "@/lib/social/visual-report-schema"

type Rgb = readonly [number, number, number]
type Locale = VisualMonitoringReportSnapshot["locale"]

const PAGE_MARGIN = 14
// Методология печатается сноской в подвале последней страницы, поэтому нижнюю
// границу контента держим выше линии футера ровно на высоту этой сноски: так
// полоса под неё свободна на любой странице и блок никогда не переносится.
const METHODOLOGY_FONT_SIZE = 6.5
const METHODOLOGY_LINE_HEIGHT = 2.9
const METHODOLOGY_MAX_LINES = 3
const PAGE_BOTTOM = 274
const DEFAULT_ACCENT: Rgb = [241, 82, 19]
const INK: Rgb = [30, 37, 50]
const MUTED: Rgb = [103, 113, 130]
const BORDER: Rgb = [224, 228, 235]
const SURFACE: Rgb = [247, 248, 251]
// Рамка карточки находки рисуется по вычисленной высоте и по содержимому не
// растягивается, поэтому потолок держим выше реального максимума (19 + бренд 4
// + источник 4 + автор 4 + 10 строк текста 42 + две ссылки 10 = 83 мм). Клип нужен
// как страховка от будущего роста, а не как штатная обрезка.
const CARD_MAX_HEIGHT = 92
const SENTIMENT_COLORS: Record<"positive" | "neutral" | "negative" | "unknown", Rgb> = {
  positive: [27, 166, 112],
  neutral: [116, 126, 145],
  negative: [220, 63, 74],
  unknown: [211, 145, 38],
}

const COPY = {
  az: {
    title: "Sosial monitorinq hesabatı",
    brands: "Brendlər",
    period: "Dövr",
    generated: "Hazırlanıb",
    summary: "Hesabatın xülasəsi",
    kpis: "Əsas göstəricilər",
    sentiment: "Tonallıq",
    platforms: "Platformalar",
    trend: "Dinamika",
    contentTypes: "Məzmun növləri",
    topFindings: "Əsas tapıntılar",
    comments: "Şərhlər və cavablar",
    findings: "Ümumi tapıntılar",
    positive: "Müsbət",
    neutral: "Neytral",
    negative: "Mənfi",
    unknown: "Müəyyən edilməyib",
    engagement: "İştirak",
    reach: "Əhatə",
    byBrand: "Brendlər üzrə",
    noData: "Bu bölmə üçün məlumat yoxdur.",
    source: "Mənbəni aç",
    origin: "Mənbə",
    authorProfile: "Müəllif profili",
    openPage: "səhifəni aç",
    openAuthorProfile: "profili aç",
    openComment: "Şərhi aç",
    openPublication: "Paylaşımı aç",
    openParentPublication: "Əsas paylaşımı aç",
    noComments: "Bu dövrdə uyğun şərh tapılmadı.",
    commentsCount: "{matched} şərhdən {shown} göstərilir.",
    findingsFilter: "Yalnız seçilmiş tonallıqlar: {sentiments}. {matched} uyğun tapıntıdan {shown} göstərilir.",
    findingsCount: "{matched} tapıntıdan {shown} göstərilir.",
    truncated: "Hesabat məlumat limitinə çatıb; nəticələr qismən göstərilir.",
    methodology: "Metodologiya",
    page: "Səhifə",
    author: "Müəllif",
  },
  ru: {
    title: "Отчёт по социальному мониторингу",
    brands: "Бренды",
    period: "Период",
    generated: "Сформирован",
    summary: "Краткое резюме",
    kpis: "Ключевые показатели",
    sentiment: "Тональность",
    platforms: "Платформы",
    trend: "Динамика",
    contentTypes: "Типы материалов",
    topFindings: "Ключевые находки",
    comments: "Комментарии и ответы",
    findings: "Всего находок",
    positive: "Позитивные",
    neutral: "Нейтральные",
    negative: "Негативные",
    unknown: "Не определено",
    engagement: "Вовлечённость",
    reach: "Охват",
    byBrand: "По брендам",
    noData: "Для этого раздела нет данных.",
    source: "Открыть источник",
    origin: "Источник",
    authorProfile: "Профиль автора",
    openPage: "открыть страницу",
    openAuthorProfile: "открыть профиль",
    openComment: "Открыть комментарий",
    openPublication: "Открыть публикацию",
    openParentPublication: "Открыть исходную публикацию",
    noComments: "За этот период релевантные комментарии не найдены.",
    commentsCount: "Показано {shown} комментариев из {matched}.",
    findingsFilter: "Только выбранные тональности: {sentiments}. Показано {shown} из {matched} подходящих.",
    findingsCount: "Показано {shown} находок из {matched}.",
    truncated: "Достигнут лимит данных отчёта; результаты показаны частично.",
    methodology: "Методология",
    page: "Страница",
    author: "Автор",
  },
  en: {
    title: "Social Monitoring Report",
    brands: "Brands",
    period: "Period",
    generated: "Generated",
    summary: "Executive summary",
    kpis: "Key metrics",
    sentiment: "Sentiment",
    platforms: "Platforms",
    trend: "Trend",
    contentTypes: "Content types",
    topFindings: "Top findings",
    comments: "Comments and replies",
    findings: "Total findings",
    positive: "Positive",
    neutral: "Neutral",
    negative: "Negative",
    unknown: "Unknown",
    engagement: "Engagement",
    reach: "Reach",
    byBrand: "By brand",
    noData: "No data is available for this section.",
    source: "Open source",
    origin: "Source",
    authorProfile: "Author profile",
    openPage: "open page",
    openAuthorProfile: "open profile",
    openComment: "Open comment",
    openPublication: "Open publication",
    openParentPublication: "Open parent post",
    noComments: "No relevant comments were found for this period.",
    commentsCount: "Showing {shown} of {matched} comments.",
    findingsFilter: "Selected sentiments only: {sentiments}. Showing {shown} of {matched} matching.",
    findingsCount: "Showing {shown} of {matched} findings.",
    truncated: "The report data limit was reached; results are partial.",
    methodology: "Methodology",
    page: "Page",
    author: "Author",
  },
} as const

function setTextColor(doc: jsPDF, color: Rgb): void {
  doc.setTextColor(color[0], color[1], color[2])
}

function setFillColor(doc: jsPDF, color: Rgb): void {
  doc.setFillColor(color[0], color[1], color[2])
}

function setDrawColor(doc: jsPDF, color: Rgb): void {
  doc.setDrawColor(color[0], color[1], color[2])
}

function parseHexColor(value: string | null | undefined): Rgb | null {
  if (!value) return null
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim())
  if (!match) return null
  const parsed = Number.parseInt(match[1], 16)
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255]
}

function safeCount(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
}

function sanitizeText(value: unknown, maxLength = 4_000): string {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function compactNumber(value: unknown, locale: Locale): string {
  const number = safeCount(value)
  const localeTag = locale === "az" ? "az-Latn-AZ" : locale === "ru" ? "ru-RU" : "en-US"
  return new Intl.NumberFormat(localeTag, {
    notation: number >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(number)
}

function formatDateOnly(value: string, locale: Locale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return sanitizeText(value, 30) || "—"
  return locale === "en" ? `${match[1]}-${match[2]}-${match[3]}` : `${match[3]}.${match[2]}.${match[1]}`
}

function formatGeneratedAt(value: string, locale: Locale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return formatDateOnly(value, locale)
  const date = locale === "en" ? `${match[1]}-${match[2]}-${match[3]}` : `${match[3]}.${match[2]}.${match[1]}`
  return `${date} ${match[4]}:${match[5]} UTC`
}

function labelForSentiment(value: string, locale: Locale): string {
  if (value === "positive") return COPY[locale].positive
  if (value === "negative") return COPY[locale].negative
  if (value === "neutral") return COPY[locale].neutral
  return COPY[locale].unknown
}

function titleCase(value: string): string {
  const normalized = sanitizeText(value, 80).replace(/[_-]+/g, " ")
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "—"
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".")
  if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part))) return false
  const octets = parts.map(Number)
  if (octets.some(octet => octet < 0 || octet > 255)) return false
  const [first, second, third] = octets
  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
}

function safeHttpUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  if (!normalized || normalized.length > 2_048) return null
  try {
    const url = new URL(normalized)
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
    const bareHostname = hostname.replace(/^\[/, "").replace(/\]$/, "")
    const ipv6 = bareHostname.includes(":")
    if (!hostname || !["http:", "https:"].includes(url.protocol) || url.username || url.password) return null
    if (
      hostname === "localhost"
      || hostname.endsWith(".localhost")
      || bareHostname === "::"
      || bareHostname === "::1"
      || (ipv6 && (/^(fc|fd)/.test(bareHostname) || /^fe[89ab]/.test(bareHostname) || /^::ffff:/i.test(bareHostname)))
      || isPrivateIpv4(hostname)
    ) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Stable PDF metadata prevents jsPDF's generated file ID/date from changing identical output. */
function stableFileId(value: unknown): string {
  const source = JSON.stringify(value) ?? ""
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  return seeds.map(seed => {
    let hash = seed >>> 0
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, "0")
  }).join("").toUpperCase()
}

function deterministicCreationDate(value: string): string {
  const parsed = new Date(value)
  const year = parsed.getUTCFullYear()
  const date = Number.isFinite(parsed.getTime()) && year >= 1970 && year <= 2037
    ? parsed
    : new Date("2000-01-01T00:00:00.000Z")
  return `D:${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}+00'00'`
}

function selected(sections: readonly VisualReportSection[], section: VisualReportSection): boolean {
  return sections.includes(section)
}

/**
 * Render a deterministic, vector-only Social Monitoring report.
 *
 * The function deliberately never loads remote logos or finding URLs. Source
 * URLs are added only as PDF link annotations, so rendering is network-free.
 */
export function buildSocialMonitoringPdf(snapshot: VisualMonitoringReportSnapshot): Uint8Array {
  const locale = snapshot.locale
  const copy = COPY[locale]
  const accent = parseHexColor(snapshot.organization.primaryColor) ?? DEFAULT_ACCENT
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true, precision: 2 })
  const font = registerUnicodeFont(doc)
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const contentWidth = pageWidth - PAGE_MARGIN * 2
  const subjectNamesById = new Map(snapshot.subjects.map(subject => [subject.id, sanitizeText(subject.name, 160)]))
  let y = 0

  doc.setFileId(stableFileId(snapshot))
  doc.setCreationDate(deterministicCreationDate(snapshot.generatedAt))
  doc.setProperties({
    title: copy.title,
    subject: sanitizeText(snapshot.summaryText, 240),
    author: sanitizeText(snapshot.organization.name, 160),
    creator: "LeadDrive",
    keywords: "social monitoring, brand protection",
  })

  const drawContinuationHeader = () => {
    setFillColor(doc, accent)
    doc.rect(0, 0, pageWidth, 6, "F")
    doc.setFont(font, "bold")
    doc.setFontSize(9)
    setTextColor(doc, INK)
    doc.text(copy.title, PAGE_MARGIN, 14)
    doc.setFont(font, "normal")
    doc.setFontSize(8)
    setTextColor(doc, MUTED)
    doc.text(fitText(snapshot.organization.name, 58), pageWidth - PAGE_MARGIN, 14, { align: "right" })
    y = 21
  }

  const addPage = () => {
    doc.addPage()
    drawContinuationHeader()
  }

  const ensureSpace = (height: number) => {
    if (y + height > PAGE_BOTTOM) addPage()
  }

  const drawSectionTitle = (title: string, estimatedBodyHeight = 8) => {
    ensureSpace(10 + estimatedBodyHeight)
    setFillColor(doc, accent)
    doc.roundedRect(PAGE_MARGIN, y - 3.5, 2.2, 7, 1, 1, "F")
    doc.setFont(font, "bold")
    doc.setFontSize(12)
    setTextColor(doc, INK)
    doc.text(title, PAGE_MARGIN + 6, y + 1)
    y += 10
  }

  const drawEmptyState = (message = copy.noData) => {
    ensureSpace(12)
    setFillColor(doc, SURFACE)
    doc.roundedRect(PAGE_MARGIN, y - 3, contentWidth, 10, 2, 2, "F")
    doc.setFont(font, "normal")
    doc.setFontSize(8.5)
    setTextColor(doc, MUTED)
    doc.text(message, PAGE_MARGIN + 4, y + 3)
    y += 14
  }

  const fitText = (value: string, maxWidth: number): string => {
    const sanitized = sanitizeText(value, 300)
    if (doc.getTextWidth(sanitized) <= maxWidth) return sanitized
    let end = sanitized.length
    while (end > 1 && doc.getTextWidth(`${sanitized.slice(0, end).trimEnd()}…`) > maxWidth) end -= 1
    return `${sanitized.slice(0, end).trimEnd()}…`
  }

  const drawWrappedText = (text: string, options?: { maxLength?: number; fontSize?: number; lineHeight?: number }) => {
    const maxLength = options?.maxLength ?? 4_000
    const fontSize = options?.fontSize ?? 9.5
    const lineHeight = options?.lineHeight ?? 4.8
    doc.setFont(font, "normal")
    doc.setFontSize(fontSize)
    setTextColor(doc, INK)
    const lines = doc.splitTextToSize(sanitizeText(text, maxLength), contentWidth) as string[]
    for (const line of lines) {
      ensureSpace(lineHeight + 1)
      doc.text(line, PAGE_MARGIN, y)
      y += lineHeight
    }
    y += 3
  }

  const drawDistribution = (
    rows: Array<{ label: string; count: number }>,
    color: Rgb,
  ) => {
    if (rows.length === 0 || rows.every(row => row.count === 0)) {
      drawEmptyState()
      return
    }
    const max = Math.max(1, ...rows.map(row => row.count))
    const barX = PAGE_MARGIN + 48
    const barWidth = contentWidth - 70
    for (const row of rows.slice(0, 20)) {
      ensureSpace(9)
      doc.setFont(font, "normal")
      doc.setFontSize(8.5)
      setTextColor(doc, INK)
      const label = sanitizeText(row.label, 50)
      const fitted = fitText(label, 43)
      doc.text(fitted || "—", PAGE_MARGIN, y + 1)
      setFillColor(doc, BORDER)
      doc.roundedRect(barX, y - 2.2, barWidth, 4.2, 1.5, 1.5, "F")
      const filled = row.count > 0 ? Math.max(1, barWidth * (row.count / max)) : 0
      if (filled > 0) {
        setFillColor(doc, color)
        const radius = Math.min(1.5, filled / 2)
        doc.roundedRect(barX, y - 2.2, filled, 4.2, radius, radius, "F")
      }
      doc.setFont(font, "bold")
      doc.text(compactNumber(row.count, locale), pageWidth - PAGE_MARGIN, y + 1, { align: "right" })
      y += 8
    }
    y += 3
  }

  const drawReportItems = (items: VisualMonitoringReportItem[]) => {
    items.forEach((finding, index) => {
      const brandNames = finding.subjectIds
        .map(subjectId => subjectNamesById.get(subjectId))
        .filter((value): value is string => Boolean(value))
      const metaParts = [
        titleCase(finding.platform),
        titleCase(finding.contentType),
        labelForSentiment(finding.sentiment, locale),
        finding.publishedAt ? formatDateOnly(finding.publishedAt, locale) : null,
      ].filter((value): value is string => Boolean(value))
      const text = sanitizeText(finding.text, 900) || "—"
      doc.setFont(font, "normal")
      doc.setFontSize(8.5)
      const textLines = (doc.splitTextToSize(text, contentWidth - 8) as string[]).slice(0, 10)
      const brandLineCount = brandNames.length > 0 ? 1 : 0
      const originText = sanitizeText(finding.source?.label ?? null, 120)
      const originLineCount = originText ? 1 : 0
      const authorText = sanitizeText(finding.authorProfile?.label ?? finding.author, 180)
      const authorLineCount = authorText ? 1 : 0
      const sourceUrl = safeHttpUrl(finding.source?.url)
      const authorUrl = safeHttpUrl(finding.authorProfile?.profileUrl)
      const directCommentUrl = safeHttpUrl(finding.directCommentUrl)
      const primaryUrl = safeHttpUrl(finding.url)
      const parentPostUrl = safeHttpUrl(finding.parentPostUrl)
      const linkRows: Array<{ label: string; url: string }> = []
      if (finding.linkKind === "direct_comment" && directCommentUrl) {
        linkRows.push({ label: copy.openComment, url: directCommentUrl })
        if (parentPostUrl && parentPostUrl !== directCommentUrl) {
          linkRows.push({ label: copy.openParentPublication, url: parentPostUrl })
        }
      } else if (primaryUrl) {
        linkRows.push({
          label: finding.linkKind === "parent_post" ? copy.openParentPublication : copy.openPublication,
          url: primaryUrl,
        })
      }
      const cardHeight = 19
        + brandLineCount * 4
        + originLineCount * 4
        + authorLineCount * 4
        + textLines.length * 4.2
        + linkRows.length * 5
      ensureSpace(Math.min(cardHeight, CARD_MAX_HEIGHT) + 5)
      const cardTop = y - 3

      setFillColor(doc, SURFACE)
      setDrawColor(doc, BORDER)
      doc.roundedRect(PAGE_MARGIN, cardTop, contentWidth, Math.min(cardHeight, CARD_MAX_HEIGHT), 2.5, 2.5, "FD")
      setFillColor(doc, SENTIMENT_COLORS[finding.sentiment])
      doc.roundedRect(PAGE_MARGIN, cardTop, 2.2, Math.min(cardHeight, CARD_MAX_HEIGHT), 1, 1, "F")

      doc.setFont(font, "bold")
      doc.setFontSize(9.5)
      setTextColor(doc, INK)
      doc.text(fitText(`${index + 1}. ${metaParts.join(" · ")}`, contentWidth - 12), PAGE_MARGIN + 6, y + 2)
      y += 6
      if (brandNames.length > 0) {
        doc.setFont(font, "bold")
        doc.setFontSize(8)
        setTextColor(doc, accent)
        doc.text(fitText(brandNames.join(", "), contentWidth - 12), PAGE_MARGIN + 6, y)
        y += 4
      }

      const drawMetadataLine = (label: string, value: string, url: string | null, action: string) => {
        doc.setFont(font, "normal")
        doc.setFontSize(7.5)
        setTextColor(doc, MUTED)
        const prefix = `${label}: `
        doc.text(prefix, PAGE_MARGIN + 6, y)
        const valueX = PAGE_MARGIN + 6 + doc.getTextWidth(prefix)
        const visible = fitText(`${value}${url ? ` · ${action}` : ""}`, contentWidth - (valueX - PAGE_MARGIN) - 6)
        if (url) {
          doc.setFont(font, "bold")
          setTextColor(doc, accent)
          doc.textWithLink(visible, valueX, y, { url })
        } else {
          doc.text(visible, valueX, y)
        }
        y += 4
      }

      if (originText) drawMetadataLine(copy.origin, originText, sourceUrl, copy.openPage)
      if (authorText) drawMetadataLine(copy.authorProfile, authorText, authorUrl, copy.openAuthorProfile)

      doc.setFont(font, "normal")
      doc.setFontSize(8.5)
      setTextColor(doc, INK)
      for (const line of textLines) {
        doc.text(line, PAGE_MARGIN + 6, y)
        y += 4.2
      }
      for (const link of linkRows) {
        y += 1
        doc.setFont(font, "bold")
        doc.setFontSize(8)
        setTextColor(doc, accent)
        doc.textWithLink(link.label, PAGE_MARGIN + 6, y, { url: link.url })
        y += 4
      }
      y = cardTop + Math.min(cardHeight, CARD_MAX_HEIGHT) + 6
    })
  }

  // First-page header.
  setFillColor(doc, accent)
  doc.rect(0, 0, pageWidth, 11, "F")
  doc.setFont(font, "bold")
  doc.setFontSize(20)
  setTextColor(doc, INK)
  doc.text(copy.title, PAGE_MARGIN, 24)
  doc.setFont(font, "normal")
  doc.setFontSize(9)
  setTextColor(doc, MUTED)
  doc.text(fitText(snapshot.organization.name, 58), pageWidth - PAGE_MARGIN, 23, { align: "right" })

  const visibleSubjects = snapshot.subjects.slice(0, 5).map(subject => sanitizeText(subject.name, 80))
  const hiddenSubjectCount = Math.max(0, snapshot.subjects.length - visibleSubjects.length)
  const subjectsLabel = `${visibleSubjects.join(", ")}${hiddenSubjectCount ? ` +${hiddenSubjectCount}` : ""}` || "—"
  const headerRows = [
    `${copy.brands}: ${subjectsLabel}`,
    `${copy.period}: ${formatDateOnly(snapshot.range.from, locale)} — ${formatDateOnly(snapshot.range.to, locale)}`,
    `${copy.generated}: ${formatGeneratedAt(snapshot.generatedAt, locale)}`,
  ]
  y = 33
  doc.setFontSize(8.5)
  for (const row of headerRows) {
    const lines = doc.splitTextToSize(row, contentWidth) as string[]
    for (const line of lines.slice(0, 3)) {
      doc.text(line, PAGE_MARGIN, y)
      y += 4.4
    }
  }
  y += 7

  if (selected(snapshot.sections, "summary")) {
    drawSectionTitle(copy.summary, 12)
    if (sanitizeText(snapshot.summaryText)) drawWrappedText(snapshot.summaryText)
    else drawEmptyState()
  }

  // A capped report must never look complete merely because the summary
  // section was disabled.
  if (snapshot.methodology.truncated) {
    ensureSpace(12)
    setFillColor(doc, [255, 246, 225])
    doc.roundedRect(PAGE_MARGIN, y - 3, contentWidth, 10, 2, 2, "F")
    doc.setFont(font, "bold")
    doc.setFontSize(8)
    doc.setTextColor(143, 90, 0)
    doc.text(copy.truncated, PAGE_MARGIN + 4, y + 3)
    y += 14
  }

  if (selected(snapshot.sections, "kpis")) {
    drawSectionTitle(copy.kpis, 54)
    const cards = [
      { label: copy.findings, value: snapshot.totals.findings, color: accent },
      { label: copy.negative, value: snapshot.totals.negative, color: SENTIMENT_COLORS.negative },
      { label: copy.neutral, value: snapshot.totals.neutral, color: SENTIMENT_COLORS.neutral },
      { label: copy.positive, value: snapshot.totals.positive, color: SENTIMENT_COLORS.positive },
      { label: copy.unknown, value: snapshot.totals.unknown, color: SENTIMENT_COLORS.unknown },
      { label: copy.engagement, value: snapshot.totals.engagement, color: [49, 111, 220] as Rgb },
      { label: copy.reach, value: snapshot.totals.reach, color: [126, 87, 194] as Rgb },
    ]
    const columns = 4
    const gap = 4
    const cardWidth = (contentWidth - gap * (columns - 1)) / columns
    const cardHeight = 22
    cards.forEach((card, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      const x = PAGE_MARGIN + column * (cardWidth + gap)
      const top = y + row * (cardHeight + gap)
      setFillColor(doc, SURFACE)
      setDrawColor(doc, BORDER)
      doc.roundedRect(x, top, cardWidth, cardHeight, 2.5, 2.5, "FD")
      setFillColor(doc, card.color)
      doc.roundedRect(x, top, 2.2, cardHeight, 1, 1, "F")
      doc.setFont(font, "normal")
      doc.setFontSize(7.5)
      setTextColor(doc, MUTED)
      doc.text(card.label, x + 6, top + 7)
      doc.setFont(font, "bold")
      doc.setFontSize(16)
      setTextColor(doc, INK)
      doc.text(compactNumber(card.value, locale), x + 6, top + 16.5)
    })
    y += cardHeight * 2 + gap + 8
    ensureSpace(15)
    doc.setFont(font, "bold")
    doc.setFontSize(9)
    setTextColor(doc, MUTED)
    doc.text(copy.byBrand, PAGE_MARGIN, y)
    y += 7
    drawDistribution(
      snapshot.subjects.map(subject => ({ label: sanitizeText(subject.name, 80), count: safeCount(subject.total) })),
      accent,
    )
  }

  if (selected(snapshot.sections, "sentiment")) {
    drawSectionTitle(copy.sentiment, 32)
    const sentiments = (["positive", "neutral", "negative", "unknown"] as const).map(sentiment => ({
      sentiment,
      count: safeCount(snapshot.sentiment.find(row => row.sentiment === sentiment)?.count),
    }))
    const total = sentiments.reduce((sum, row) => sum + row.count, 0)
    if (total === 0) {
      drawEmptyState()
    } else {
      const barY = y
      let barX = PAGE_MARGIN
      for (const row of sentiments) {
        const width = contentWidth * (row.count / total)
        if (width > 0) {
          setFillColor(doc, SENTIMENT_COLORS[row.sentiment])
          doc.rect(barX, barY, width, 8, "F")
          if (width >= 18) {
            doc.setFont(font, "bold")
            doc.setFontSize(7.5)
            doc.setTextColor(255, 255, 255)
            doc.text(`${Math.round((row.count / total) * 100)}%`, barX + width / 2, barY + 5.2, { align: "center" })
          }
          barX += width
        }
      }
      y += 15
      sentiments.forEach((row, index) => {
        const x = PAGE_MARGIN + index * (contentWidth / 4)
        setFillColor(doc, SENTIMENT_COLORS[row.sentiment])
        doc.circle(x + 2, y - 1.2, 1.6, "F")
        doc.setFont(font, "normal")
        doc.setFontSize(8)
        setTextColor(doc, MUTED)
        doc.text(`${labelForSentiment(row.sentiment, locale)}  ${compactNumber(row.count, locale)}`, x + 6, y)
      })
      y += 10
    }
  }

  if (selected(snapshot.sections, "platforms")) {
    drawSectionTitle(copy.platforms, 16)
    drawDistribution(
      snapshot.platforms.map(row => ({ label: titleCase(row.platform), count: safeCount(row.count) })),
      accent,
    )
  }

  if (selected(snapshot.sections, "trend")) {
    drawSectionTitle(copy.trend, 58)
    const ordered = [...snapshot.trend]
      .filter(row => /^\d{4}-\d{2}-\d{2}/.test(row.date))
      .sort((left, right) => left.date.localeCompare(right.date))
    if (ordered.length === 0) {
      drawEmptyState()
    } else {
      ensureSpace(56)
      const maxPoints = 64
      const stride = Math.max(1, Math.ceil(ordered.length / maxPoints))
      const sampled = ordered.filter((_, index) => index % stride === 0)
      if (sampled.at(-1) !== ordered.at(-1)) sampled.push(ordered[ordered.length - 1])
      const chartX = PAGE_MARGIN + 8
      const chartY = y
      const chartWidth = contentWidth - 12
      const chartHeight = 38
      const maxValue = Math.max(1, ...sampled.flatMap(row => [
        safeCount(row.total), safeCount(row.positive), safeCount(row.neutral), safeCount(row.negative), safeCount(row.unknown),
      ]))

      setDrawColor(doc, BORDER)
      doc.setLineWidth(0.2)
      for (let line = 0; line <= 4; line += 1) {
        const lineY = chartY + (chartHeight * line) / 4
        doc.line(chartX, lineY, chartX + chartWidth, lineY)
      }

      const series: Array<{ key: "total" | "positive" | "neutral" | "negative" | "unknown"; color: Rgb }> = [
        { key: "total", color: INK },
        { key: "positive", color: SENTIMENT_COLORS.positive },
        { key: "neutral", color: SENTIMENT_COLORS.neutral },
        { key: "negative", color: SENTIMENT_COLORS.negative },
        { key: "unknown", color: SENTIMENT_COLORS.unknown },
      ]
      for (const item of series) {
        setDrawColor(doc, item.color)
        doc.setLineWidth(item.key === "total" ? 0.8 : 0.45)
        sampled.forEach((row, index) => {
          if (index === 0) return
          const previous = sampled[index - 1]
          const denominator = Math.max(1, sampled.length - 1)
          const x1 = chartX + (chartWidth * (index - 1)) / denominator
          const x2 = chartX + (chartWidth * index) / denominator
          const y1 = chartY + chartHeight - (chartHeight * safeCount(previous[item.key])) / maxValue
          const y2 = chartY + chartHeight - (chartHeight * safeCount(row[item.key])) / maxValue
          doc.line(x1, y1, x2, y2)
        })
      }

      doc.setFont(font, "normal")
      doc.setFontSize(7)
      setTextColor(doc, MUTED)
      doc.text(compactNumber(maxValue, locale), PAGE_MARGIN + 5, chartY + 2, { align: "right" })
      doc.text("0", PAGE_MARGIN + 5, chartY + chartHeight, { align: "right" })
      doc.text(formatDateOnly(sampled[0].date, locale), chartX, chartY + chartHeight + 5)
      doc.text(formatDateOnly(sampled[sampled.length - 1].date, locale), chartX + chartWidth, chartY + chartHeight + 5, { align: "right" })
      y += chartHeight + 12
    }
  }

  if (selected(snapshot.sections, "contentTypes")) {
    drawSectionTitle(copy.contentTypes, 16)
    drawDistribution(
      snapshot.contentTypes.map(row => ({ label: titleCase(row.contentType), count: safeCount(row.count) })),
      [49, 111, 220],
    )
  }

  if (selected(snapshot.sections, "topFindings")) {
    drawSectionTitle(copy.topFindings, 20)
    // Раздел показывает не всё: его сужает и выбор тональностей, и лимит
    // количества. Счётчики выше при этом считаются по всем находкам периода —
    // молчать нельзя, иначе клиент увидит «10 находок» под KPI со 137 и
    // решит, что часть данных потеряна.
    const findingsFilter = snapshot.topFindingsFilter
    const narrowedSentiments = Boolean(findingsFilter) && findingsFilter.sentiments.length < 4
    const truncatedByLimit = Boolean(findingsFilter) && findingsFilter.shown < findingsFilter.matched
    if (findingsFilter && (narrowedSentiments || truncatedByLimit)) {
      const note = (narrowedSentiments ? copy.findingsFilter : copy.findingsCount)
        .replace("{sentiments}", findingsFilter.sentiments.map(value => labelForSentiment(value, locale)).join(", "))
        .replace("{shown}", String(safeCount(findingsFilter.shown)))
        .replace("{matched}", String(safeCount(findingsFilter.matched)))
      drawWrappedText(note, { fontSize: 7.5, lineHeight: 4 })
      y += 2
    }
    if (snapshot.topFindings.length === 0) {
      drawEmptyState()
    } else {
      drawReportItems(snapshot.topFindings)
    }
  }

  if (selected(snapshot.sections, "comments")) {
    drawSectionTitle(copy.comments, 20)
    const commentsFilter = snapshot.commentsFilter
    if (commentsFilter.shown < commentsFilter.matched) {
      drawWrappedText(copy.commentsCount
        .replace("{shown}", String(safeCount(commentsFilter.shown)))
        .replace("{matched}", String(safeCount(commentsFilter.matched))), {
        fontSize: 7.5,
        lineHeight: 4,
      })
      y += 2
    }
    if (snapshot.comments.length === 0) drawEmptyState(copy.noComments)
    else drawReportItems(snapshot.comments)
  }

  // Compact methodology note is always included so report counting semantics
  // remain auditable even when the user hides visual sections. Печатаем её
  // сноской в подвале последней страницы, а не в потоке: в потоке блок
  // регулярно не влезал в остаток листа и уводил за собой целую пустую
  // страницу — под тремя строками оставалось ~250 мм белого поля.
  const methodology = [
    `dateField=${snapshot.methodology.dateField}`,
    `globalDeduplication=${snapshot.methodology.globalDeduplication}`,
    `subjectMatchStatus=${snapshot.methodology.subjectMatchStatus}`,
    `unclassifiedSentiment=${snapshot.methodology.unclassifiedSentiment}`,
    `dataLimit=${safeCount(snapshot.methodology.dataLimit)}`,
    `truncated=${snapshot.methodology.truncated}`,
  ].join(" · ")
  doc.setFont(font, "normal")
  doc.setFontSize(METHODOLOGY_FONT_SIZE)
  const methodologyLines = (doc.splitTextToSize(`${copy.methodology}: ${methodology}`, contentWidth) as string[])
    .slice(0, METHODOLOGY_MAX_LINES)

  // Footers are written after all content so every page receives the correct
  // total page count and the same deterministic generated-at value.
  const totalPages = doc.getNumberOfPages()
  const footerRuleY = pageHeight - 12
  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page)
    if (page === totalPages) {
      doc.setFont(font, "normal")
      doc.setFontSize(METHODOLOGY_FONT_SIZE)
      setTextColor(doc, MUTED)
      methodologyLines.forEach((line, index) => {
        const fromBottom = (methodologyLines.length - 1 - index) * METHODOLOGY_LINE_HEIGHT
        doc.text(line, PAGE_MARGIN, footerRuleY - 1.6 - fromBottom)
      })
    }
    setDrawColor(doc, BORDER)
    doc.setLineWidth(0.2)
    doc.line(PAGE_MARGIN, footerRuleY, pageWidth - PAGE_MARGIN, footerRuleY)
    doc.setFont(font, "normal")
    doc.setFontSize(7)
    setTextColor(doc, MUTED)
    doc.text(
      `${fitText(snapshot.organization.name, 100)} · ${formatGeneratedAt(snapshot.generatedAt, locale)}`,
      PAGE_MARGIN,
      pageHeight - 7,
    )
    doc.text(`${copy.page} ${page} / ${totalPages}`, pageWidth - PAGE_MARGIN, pageHeight - 7, { align: "right" })
  }

  return new Uint8Array(doc.output("arraybuffer"))
}
