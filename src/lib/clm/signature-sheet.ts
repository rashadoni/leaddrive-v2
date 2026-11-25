/**
 * The signature sheet («İmza vərəqi») of a contract signed through LeadDrive's
 * own e-sign flow: who signed, how, when and from which address, and the
 * SHA-256 fingerprint of the exact text they signed. It is the last page of
 * the signed contract PDF, and the contract card shows the same facts.
 *
 * The signatures here are simple electronic signatures (drawn or typed). The
 * sheet says so in its own words: only a qualified signature (ASAN İmza, SİMA)
 * stands in for a handwritten one, and the sheet must not read as if it were one.
 *
 * Three layers, so the words can be tested without reading a PDF:
 *   signatureSheetContent — the facts in the reader's language and time zone;
 *   parseSignatureStrokes  — a drawn signature's path as strokes;
 *   drawSignatureSheet     — puts the content on jsPDF pages.
 */
import type jsPDF from "jspdf"

export type SheetLang = "az" | "ru" | "en"

export function sheetLang(raw: string | null | undefined): SheetLang {
  return raw === "ru" || raw === "en" ? raw : "az"
}

/** An IANA zone the runtime knows, else UTC — a bad `tz` never breaks the PDF. */
export function sheetTimeZone(raw: string | null | undefined): string {
  if (!raw) return "UTC"
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: raw })
    return raw
  } catch {
    return "UTC"
  }
}

export interface SignatureSheetSigner {
  order: number
  fullName: string
  email: string
  /** signer | cc | copy */
  role: string
  status: string
  /** drawn | typed | uploaded */
  signatureMethod: string | null
  signaturePayload: unknown
  viewedAt: Date | null
  signedAt: Date | null
  signedIpAddress: string | null
}

export interface SignatureSheet {
  sentAt: Date | null
  completedAt: Date | null
  /**
   * The immutable contract version the envelope produced when the last signer
   * signed; null for a price protocol or act, which has no versions.
   */
  versionNo: number | null
  contentHash: string
  signers: SignatureSheetSigner[]
}

const WORDS: Record<SheetLang, Record<string, string>> = {
  az: {
    title: "İMZA VƏRƏQİ",
    document: "Sənəd",
    version: "İmzalanmış versiya",
    fingerprint: "Sənədin izi (SHA-256)",
    sent: "Göndərildi",
    completed: "Tamamlandı",
    email: "E-poçt",
    method: "İmza üsulu",
    viewed: "Baxıldı",
    signed: "İmzalandı",
    ip: "IP ünvanı",
    drawn: "Sadə elektron imza — əl ilə çəkilib",
    typed: "Sadə elektron imza — ad yazılıb",
    uploaded: "Sadə elektron imza — şəkil yüklənib",
    unknown: "Sadə elektron imza",
    notSigned: "İmzalamayıb",
    copies: "Surət alanlar",
    note:
      "Bu vərəq LeadDrive-ın imza anında qeydə aldığı məlumatlardan tərtib olunub. İmzalar sadə elektron imzadır (gücləndirilmiş deyil). " +
      "Sənədin izi imzalanmış mətni müəyyən edir: mətndə bir hərf dəyişsə, iz də dəyişir.",
  },
  ru: {
    title: "ЛИСТ ПОДПИСЕЙ",
    document: "Документ",
    version: "Подписанная версия",
    fingerprint: "Отпечаток документа (SHA-256)",
    sent: "Отправлен",
    completed: "Завершён",
    email: "E-mail",
    method: "Способ подписи",
    viewed: "Открыл",
    signed: "Подписал",
    ip: "IP-адрес",
    drawn: "Простая электронная подпись — нарисована от руки",
    typed: "Простая электронная подпись — введено имя",
    uploaded: "Простая электронная подпись — загружено изображение",
    unknown: "Простая электронная подпись",
    notSigned: "Не подписал",
    copies: "Копии получили",
    note:
      "Лист составлен LeadDrive по данным, записанным в момент подписания. Подписи простые электронные (не усиленные). " +
      "Отпечаток определяет подписанный текст: изменится одна буква — изменится и отпечаток.",
  },
  en: {
    title: "SIGNATURE SHEET",
    document: "Document",
    version: "Signed version",
    fingerprint: "Document fingerprint (SHA-256)",
    sent: "Sent",
    completed: "Completed",
    email: "Email",
    method: "Signature method",
    viewed: "Opened",
    signed: "Signed",
    ip: "IP address",
    drawn: "Simple electronic signature — drawn by hand",
    typed: "Simple electronic signature — typed name",
    uploaded: "Simple electronic signature — uploaded image",
    unknown: "Simple electronic signature",
    notSigned: "Not signed",
    copies: "Copies sent to",
    note:
      "Compiled by LeadDrive from what it recorded at the moment of signing. The signatures are simple electronic signatures (not qualified). " +
      "The fingerprint identifies the signed text: change one letter and the fingerprint changes.",
  },
}

/**
 * `25.11.2026 14:05:09 (UTC+4)` in the given zone; the offset is always
 * printed. It is computed here rather than taken from ICU's zone name, which
 * reads «GMT», «GMT+0» or «UTC» depending on the runtime's ICU build.
 */
export function formatSheetTime(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ""
  const wall = Date.UTC(
    Number(get("year")),
    Number(get("month")) - 1,
    Number(get("day")),
    Number(get("hour")),
    Number(get("minute")),
    Number(get("second")),
  )
  const offsetMinutes = Math.round((wall - Math.floor(date.getTime() / 1000) * 1000) / 60000)
  const sign = offsetMinutes < 0 ? "-" : "+"
  const abs = Math.abs(offsetMinutes)
  const offset =
    abs === 0 ? "UTC" : `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${String(abs % 60).padStart(2, "0")}` : ""}`
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}:${get("second")} (${offset})`
}

export type SignatureMark =
  | { kind: "typed"; text: string }
  | { kind: "drawn"; strokes: Array<Array<[number, number]>>; width: number; height: number }
  | { kind: "none" }

/**
 * A drawn signature as the signing page stores it — `M12.0,34.5 L13.0,35.0 …`
 * — split into strokes. Anything that is not a move or a line is skipped, so a
 * malformed path draws less, never throws.
 */
export function parseSignatureStrokes(svgPath: string): Array<Array<[number, number]>> {
  const strokes: Array<Array<[number, number]>> = []
  let current: Array<[number, number]> | null = null
  const command = /([MLml])\s*(-?\d+(?:\.\d+)?)\s*[\s,]\s*(-?\d+(?:\.\d+)?)/g
  for (const match of svgPath.matchAll(command)) {
    const point: [number, number] = [Number(match[2]), Number(match[3])]
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue
    if (match[1].toUpperCase() === "M" || !current) {
      current = [point]
      strokes.push(current)
    } else {
      current.push(point)
    }
  }
  return strokes
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function signatureMark(signer: Pick<SignatureSheetSigner, "signatureMethod" | "signaturePayload">): SignatureMark {
  const payload = record(signer.signaturePayload)
  if (signer.signatureMethod === "typed" && typeof payload?.typedName === "string" && payload.typedName.trim()) {
    return { kind: "typed", text: payload.typedName.trim() }
  }
  if (signer.signatureMethod === "drawn" && typeof payload?.svgPath === "string") {
    const strokes = parseSignatureStrokes(payload.svgPath)
    const width = typeof payload.widthPx === "number" && payload.widthPx > 0 ? payload.widthPx : 600
    const height = typeof payload.heightPx === "number" && payload.heightPx > 0 ? payload.heightPx : 180
    if (strokes.length > 0) return { kind: "drawn", strokes, width, height }
  }
  return { kind: "none" }
}

export interface SignatureSheetContent {
  title: string
  facts: Array<[string, string]>
  signers: Array<{ heading: string; facts: Array<[string, string]>; mark: SignatureMark }>
  copies: string | null
  note: string
}

export function signatureSheetContent(
  sheet: SignatureSheet,
  document: { contractNumber: string; title: string },
  lang: SheetLang,
  timeZone: string,
): SignatureSheetContent {
  const w = WORDS[lang]
  const time = (d: Date | null) => (d ? formatSheetTime(d, timeZone) : "—")
  const facts: Array<[string, string]> = [
    [w.document, `${document.contractNumber} · ${document.title}`],
    ...(sheet.versionNo !== null ? ([[w.version, `№ ${sheet.versionNo}`]] as Array<[string, string]>) : []),
    [w.fingerprint, sheet.contentHash],
    [w.sent, time(sheet.sentAt)],
    [w.completed, time(sheet.completedAt)],
  ]
  const ordered = [...sheet.signers].sort((a, b) => a.order - b.order)
  const signers = ordered
    .filter((s) => s.role === "signer")
    .map((s, index) => {
      const method =
        s.signatureMethod === "drawn" || s.signatureMethod === "typed" || s.signatureMethod === "uploaded"
          ? w[s.signatureMethod]
          : w.unknown
      const rows: Array<[string, string]> = [[w.email, s.email]]
      if (s.status === "signed" && s.signedAt) {
        rows.push([w.method, method], [w.viewed, time(s.viewedAt)], [w.signed, time(s.signedAt)])
        if (s.signedIpAddress) rows.push([w.ip, s.signedIpAddress])
      } else {
        rows.push([w.signed, w.notSigned])
      }
      return {
        heading: `${index + 1}. ${s.fullName}`,
        facts: rows,
        mark: s.status === "signed" ? signatureMark(s) : ({ kind: "none" } as SignatureMark),
      }
    })
  const copyList = ordered.filter((s) => s.role !== "signer").map((s) => `${s.fullName} (${s.email})`)
  return {
    title: w.title,
    facts,
    signers,
    copies: copyList.length > 0 ? `${w.copies}: ${copyList.join(", ")}` : null,
    note: w.note,
  }
}

/**
 * Draws the sheet from a fresh page. `font` is the Unicode font already
 * registered on `doc` (Azerbaijani and Cyrillic need it).
 */
export function drawSignatureSheet(doc: jsPDF, font: string, content: SignatureSheetContent): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const labelWidth = 52
  const valueWidth = pageWidth - margin * 2 - labelWidth
  const bottom = pageHeight - 18

  doc.addPage()
  let y = 22

  doc.setFont(font, "bold")
  doc.setFontSize(15)
  doc.setTextColor(20, 20, 20)
  doc.text(content.title, margin, y)
  y += 9

  const factRows = (rows: Array<[string, string]>, x: number, width: number, startY: number, labelW: number) => {
    let yy = startY
    for (const [label, value] of rows) {
      doc.setFont(font, "normal")
      doc.setFontSize(8.5)
      doc.setTextColor(115, 115, 115)
      doc.text(label, x, yy)
      doc.setTextColor(25, 25, 25)
      doc.setFontSize(9.5)
      const lines = doc.splitTextToSize(value, width - labelW) as string[]
      doc.text(lines, x + labelW, yy)
      yy += Math.max(1, lines.length) * 4.6 + 1.4
    }
    return yy
  }

  y = factRows(content.facts, margin, pageWidth - margin * 2, y, labelWidth)
  y += 4

  const markWidth = 62
  const markHeight = 22
  for (const signer of content.signers) {
    const textWidth = pageWidth - margin * 2 - markWidth - 10
    doc.setFontSize(9.5)
    const estimatedHeight =
      16 +
      signer.facts.reduce((h, [, value]) => h + Math.max(1, (doc.splitTextToSize(value, textWidth - 34) as string[]).length) * 4.6 + 1.4, 0)
    const boxHeight = Math.max(estimatedHeight, markHeight + 14)
    if (y + boxHeight > bottom) {
      doc.addPage()
      y = 22
    }

    doc.setDrawColor(210, 210, 210)
    doc.setLineWidth(0.3)
    doc.roundedRect(margin, y, pageWidth - margin * 2, boxHeight, 2, 2, "S")

    doc.setFont(font, "bold")
    doc.setFontSize(11)
    doc.setTextColor(20, 20, 20)
    doc.text(signer.heading, margin + 4, y + 7)
    factRows(signer.facts, margin + 4, textWidth, y + 13, 34)

    const markX = pageWidth - margin - markWidth - 4
    const markY = y + 6
    doc.setDrawColor(200, 200, 200)
    doc.setLineWidth(0.2)
    doc.line(markX, markY + markHeight, markX + markWidth, markY + markHeight)
    drawMark(doc, font, signer.mark, markX, markY, markWidth, markHeight)

    y += boxHeight + 5
  }

  const tail = [content.copies, content.note].filter((t): t is string => Boolean(t))
  for (const text of tail) {
    doc.setFont(font, "normal")
    doc.setFontSize(8.5)
    doc.setTextColor(110, 110, 110)
    const lines = doc.splitTextToSize(text, pageWidth - margin * 2) as string[]
    if (y + lines.length * 4.2 > bottom) {
      doc.addPage()
      y = 22
    }
    doc.text(lines, margin, y)
    y += lines.length * 4.2 + 3
  }
}

function drawMark(doc: jsPDF, font: string, mark: SignatureMark, x: number, y: number, width: number, height: number) {
  if (mark.kind === "typed") {
    doc.setFont(font, "bold")
    doc.setTextColor(26, 26, 46)
    let size = 18
    doc.setFontSize(size)
    while (size > 9 && doc.getTextWidth(mark.text) > width) {
      size -= 1
      doc.setFontSize(size)
    }
    doc.text(mark.text, x + 1, y + height - 4)
    return
  }
  if (mark.kind === "drawn") {
    const scale = Math.min(width / mark.width, height / mark.height)
    const offsetX = x + (width - mark.width * scale) / 2
    const offsetY = y + (height - mark.height * scale) / 2
    doc.setDrawColor(26, 26, 46)
    doc.setLineWidth(0.45)
    for (const stroke of mark.strokes) {
      for (let i = 1; i < stroke.length; i++) {
        const [x1, y1] = stroke[i - 1]
        const [x2, y2] = stroke[i]
        doc.line(offsetX + x1 * scale, offsetY + y1 * scale, offsetX + x2 * scale, offsetY + y2 * scale)
      }
    }
  }
}
