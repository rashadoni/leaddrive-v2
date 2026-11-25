/**
 * Documents that follow a contract (owner 2026-11-25, mock «Протокол цены и акт»):
 *
 *   price_protocol — «Qiymət razılaşdırma protokolu», annex Əlavə №N: the goods
 *                    and services with their agreed prices and the period they
 *                    hold. The contract's invoices take their lines and prices
 *                    from it, and a different price is shown, not passed silently.
 *   acceptance_act — «Təhvil-təslim aktı» №N, made from an invoice: what was
 *                    actually handed over and accepted.
 *
 * Prices are without VAT and a document has one VAT rate (a fraction), the
 * way invoices count it (src/lib/invoice-calculations.ts), so a protocol and an
 * invoice compare line by line.
 *
 * Pure: the routes load and write; this numbers, sums, picks and words.
 */

export const DOCUMENT_KINDS = ["price_protocol", "acceptance_act"] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]
export const DOCUMENT_STATUSES = ["draft", "in_signing", "signed", "cancelled"] as const
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number]
export type DocLang = "az" | "ru" | "en"

export interface DocumentLine {
  productId: string | null
  name: string
  unit: string | null
  /** A protocol fixes prices; its quantity may be null. */
  quantity: number | null
  unitPrice: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function lineAmount(line: Pick<DocumentLine, "quantity" | "unitPrice">): number {
  return line.quantity === null ? 0 : round2(line.quantity * line.unitPrice)
}

export function documentTotals(lines: Pick<DocumentLine, "quantity" | "unitPrice">[], vatRate: number) {
  const subtotal = round2(lines.reduce((sum, line) => sum + lineAmount(line), 0))
  const vatAmount = round2(subtotal * vatRate)
  return { subtotal, vatAmount, totalAmount: round2(subtotal + vatAmount) }
}

/** The next number of this kind in this contract: Əlavə №1, №2…; Akt №1, №2… */
export function nextNumber(existing: number[]): number {
  return existing.reduce((max, n) => Math.max(max, n), 0) + 1
}

/**
 * A deal's product lines as protocol lines: the price after the line's
 * discount, since that is the price agreed. A line without a price keeps 0
 * for a person to set.
 */
export function linesFromDeal(
  items: Array<{ productId: string | null; name: string; quantity: unknown; unitPrice: unknown; discountPct?: unknown; product?: { unit: string | null } | null }>,
): DocumentLine[] {
  return items.map((item) => {
    const price = toNumber(item.unitPrice) ?? 0
    const discount = toNumber(item.discountPct) ?? 0
    return {
      productId: item.productId,
      name: item.name,
      unit: item.product?.unit ?? null,
      quantity: toNumber(item.quantity),
      unitPrice: discount ? round2(price * (1 - discount / 100)) : price,
    }
  })
}

/** An invoice's lines as act lines: the same goods, the same quantities, the same prices. */
export function linesFromInvoice(
  items: Array<{ productId: string | null; name: string; quantity: unknown; unitPrice: unknown; discount?: unknown }>,
): DocumentLine[] {
  return items.map((item) => {
    const discount = toNumber(item.discount) ?? 0
    const price = toNumber(item.unitPrice) ?? 0
    return {
      productId: item.productId,
      name: item.name,
      unit: null,
      quantity: toNumber(item.quantity) ?? 1,
      // A line discount is part of the price the act confirms.
      unitPrice: discount ? round2(price * (1 - discount / 100)) : price,
    }
  })
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(typeof value === "object" ? String(value) : value)
  return Number.isFinite(n) ? n : null
}

export interface ProtocolRow {
  id: string
  number: number
  status: string
  validFrom: Date | null
  validTo: Date | null
  documentDate: Date
}

/**
 * The protocol whose prices hold on `at`: the latest signed one whose period
 * covers the day; failing that, the latest draft — its prices are what the
 * parties are about to agree, and the screen says it is not signed yet.
 * Cancelled ones never count.
 */
export function activeProtocol<T extends ProtocolRow>(protocols: T[], at: Date): { protocol: T; signed: boolean } | null {
  const day = at.getTime()
  const covers = (p: T) => (!p.validFrom || p.validFrom.getTime() <= day) && (!p.validTo || p.validTo.getTime() >= day - 86_399_999)
  const byNumber = [...protocols].sort((a, b) => b.number - a.number)
  const signed = byNumber.find((p) => p.status === "signed" && covers(p))
  if (signed) return { protocol: signed, signed: true }
  const draft = byNumber.find((p) => p.status === "draft" || p.status === "in_signing")
  return draft ? { protocol: draft, signed: false } : null
}

const normalName = (name: string) => name.toLocaleLowerCase("az").replace(/\s+/g, " ").trim()

export interface PriceDeviation {
  itemIndex: number
  name: string
  invoicePrice: number
  protocolPrice: number
}

/**
 * Invoice lines whose price is not the protocol's. A line is the protocol's by
 * its product, else by its name; a line the protocol does not name is not a
 * deviation (an extra service, a one-off) — it is just not in the protocol.
 */
export function priceDeviations(
  items: Array<{ productId: string | null; name: string; unitPrice: unknown }>,
  protocolLines: Array<Pick<DocumentLine, "productId" | "name" | "unitPrice">>,
): PriceDeviation[] {
  const byProduct = new Map(protocolLines.filter((l) => l.productId).map((l) => [l.productId as string, l]))
  const byName = new Map(protocolLines.map((l) => [normalName(l.name), l]))
  const out: PriceDeviation[] = []
  items.forEach((item, itemIndex) => {
    const match = (item.productId && byProduct.get(item.productId)) || byName.get(normalName(item.name))
    const price = toNumber(item.unitPrice)
    if (!match || price === null) return
    if (Math.abs(price - match.unitPrice) > 0.005) out.push({ itemIndex, name: item.name, invoicePrice: price, protocolPrice: match.unitPrice })
  })
  return out
}

// ─── Words ──────────────────────────────────────────────────────────────────

export interface DocumentWords {
  title: string
  subtitle: string
  intro: string
  closing: string
  columns: { no: string; name: string; unit: string; quantity: string; price: string; amount: string }
  subtotal: string
  vat: string
  total: string
  validity: string
  sideA: string
  sideB: string
  director: string
  signature: string
  city: string
}

export interface DocumentFacts {
  kind: DocumentKind
  number: number
  documentDate: Date
  validFrom: Date | null
  validTo: Date | null
  contractNumber: string
  /** The day the contract was signed, else made. */
  contractDate: Date
  contractTitle: string
  our: { name: string; director: string | null }
  counterparty: { name: string; director: string | null }
  /** The invoice an act closes. */
  invoiceNumber: string | null
  vatRate: number
}

export function docDate(date: Date): string {
  return date.toISOString().slice(0, 10).split("-").reverse().join(".")
}

const vatPercent = (rate: number) => `${round2(rate * 100)}%`

export function documentWords(facts: DocumentFacts, lang: DocLang): DocumentWords {
  const d = docDate(facts.documentDate)
  const cd = docDate(facts.contractDate)
  const period = facts.validFrom || facts.validTo ? `${facts.validFrom ? docDate(facts.validFrom) : "…"} — ${facts.validTo ? docDate(facts.validTo) : "…"}` : ""
  const vat = vatPercent(facts.vatRate)
  if (lang === "ru") {
    const protocol = facts.kind === "price_protocol"
    return {
      title: protocol ? "ПРОТОКОЛ СОГЛАСОВАНИЯ ЦЕН" : `АКТ ПРИЁМА-ПЕРЕДАЧИ № ${facts.number}`,
      subtitle: protocol
        ? `Приложение № ${facts.number} к договору № ${facts.contractNumber} от ${cd}`
        : `к договору № ${facts.contractNumber} от ${cd}${facts.invoiceNumber ? `, счёт-фактура № ${facts.invoiceNumber}` : ""}`,
      intro: protocol
        ? `«${facts.our.name}» и «${facts.counterparty.name}» согласовали цены на следующие товары (услуги) по договору № ${facts.contractNumber} «${facts.contractTitle}» от ${cd}:`
        : `С одной стороны «${facts.our.name}», с другой стороны «${facts.counterparty.name}» составили настоящий акт о том, что по договору № ${facts.contractNumber} «${facts.contractTitle}» от ${cd} переданы и приняты следующие товары (услуги):`,
      closing: protocol
        ? "Цены указаны без НДС. Протокол является неотъемлемой частью договора и вступает в силу с момента подписания Сторонами."
        : "Стороны не имеют претензий друг к другу по качеству, количеству и срокам. Акт является неотъемлемой частью договора.",
      columns: { no: "№", name: "Товар / услуга", unit: "Ед.", quantity: "Кол-во", price: "Цена", amount: "Сумма" },
      subtotal: "Итого без НДС",
      vat: `НДС ${vat}`,
      total: "Всего",
      validity: period ? `Цены действуют: ${period}` : "",
      sideA: "Сторона 1",
      sideB: "Сторона 2",
      director: "Директор",
      signature: "Подпись",
      city: `г. Баку, ${d}`,
    }
  }
  if (lang === "en") {
    const protocol = facts.kind === "price_protocol"
    return {
      title: protocol ? "PRICE AGREEMENT PROTOCOL" : `ACCEPTANCE ACT No. ${facts.number}`,
      subtitle: protocol
        ? `Appendix No. ${facts.number} to agreement No. ${facts.contractNumber} dated ${cd}`
        : `to agreement No. ${facts.contractNumber} dated ${cd}${facts.invoiceNumber ? `, invoice No. ${facts.invoiceNumber}` : ""}`,
      intro: protocol
        ? `«${facts.our.name}» and «${facts.counterparty.name}» have agreed the prices of the following goods (services) under agreement No. ${facts.contractNumber} «${facts.contractTitle}» dated ${cd}:`
        : `«${facts.our.name}» on one hand and «${facts.counterparty.name}» on the other have drawn up this act confirming that under agreement No. ${facts.contractNumber} «${facts.contractTitle}» dated ${cd} the following goods (services) were delivered and accepted:`,
      closing: protocol
        ? "Prices exclude VAT. This protocol is an integral part of the agreement and enters into force when signed by the Parties."
        : "The Parties have no claims against each other as to quality, quantity or timing. This act is an integral part of the agreement.",
      columns: { no: "No.", name: "Goods / service", unit: "Unit", quantity: "Qty", price: "Price", amount: "Amount" },
      subtotal: "Subtotal excl. VAT",
      vat: `VAT ${vat}`,
      total: "Total",
      validity: period ? `Prices hold: ${period}` : "",
      sideA: "Party 1",
      sideB: "Party 2",
      director: "Director",
      signature: "Signature",
      city: `Baku, ${d}`,
    }
  }
  const protocol = facts.kind === "price_protocol"
  return {
    title: protocol ? "QİYMƏT RAZILAŞDIRMA PROTOKOLU" : `TƏHVİL-TƏSLİM AKTI № ${facts.number}`,
    subtitle: protocol
      ? `${cd} tarixli ${facts.contractNumber} nömrəli müqaviləyə Əlavə № ${facts.number}`
      : `${cd} tarixli ${facts.contractNumber} nömrəli müqavilə üzrə${facts.invoiceNumber ? `, ${facts.invoiceNumber} nömrəli hesab-faktura` : ""}`,
    intro: protocol
      ? `«${facts.our.name}» və «${facts.counterparty.name}» ${cd} tarixli ${facts.contractNumber} nömrəli «${facts.contractTitle}» müqaviləsi üzrə aşağıdakı malların (xidmətlərin) qiymətlərini razılaşdırmışlar:`
      : `Bir tərəfdən «${facts.our.name}», digər tərəfdən «${facts.counterparty.name}» arasında bağlanılmış ${cd} tarixli ${facts.contractNumber} nömrəli «${facts.contractTitle}» müqaviləsinə əsasən aşağıdakı mallar (xidmətlər) təhvil verilmiş və qəbul edilmişdir:`,
    closing: protocol
      ? "Qiymətlər ƏDV-siz göstərilib. Protokol müqavilənin ayrılmaz hissəsidir və Tərəflərin imzaladığı andan qüvvəyə minir."
      : "Tərəflərin bir-birinə qarşı keyfiyyət, miqdar və müddət üzrə iddiaları yoxdur. Akt müqavilənin ayrılmaz hissəsidir.",
    columns: { no: "№", name: "Mal / xidmət", unit: "Vahid", quantity: "Miqdar", price: "Qiymət", amount: "Məbləğ" },
    subtotal: "Cəmi ƏDV-siz",
    vat: `ƏDV ${vat}`,
    total: "Yekun",
    validity: period ? `Qiymətlər qüvvədədir: ${period}` : "",
    sideA: "Tərəf 1",
    sideB: "Tərəf 2",
    director: "Direktor",
    signature: "İmza",
    city: `Bakı şəhəri, ${d}`,
  }
}

/** `38 700,00` — grouped by spaces, a comma before the cents, as AZ and RU documents write sums. */
export function moneyText(amount: number): string {
  const [whole, cents] = Math.abs(amount).toFixed(2).split(".")
  return `${amount < 0 ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${cents}`
}

/** `400` / `2,5` — a quantity without trailing zeros. */
export function quantityText(quantity: number | null): string {
  if (quantity === null) return "—"
  return String(Math.round(quantity * 10000) / 10000).replace(".", ",")
}

/**
 * The document as text — what the signing page shows and what is frozen and
 * hashed when the document goes for signing. Built from the same words and
 * numbers as the PDF, so the two say the same thing.
 */
export function documentSigningText(facts: DocumentFacts, lines: DocumentLine[], currency: string, lang: DocLang): string {
  const w = documentWords(facts, lang)
  const totals = documentTotals(lines, facts.vatRate)
  const rows = lines.map((line, i) => {
    const qty = line.quantity === null ? "" : ` — ${quantityText(line.quantity)}${line.unit ? ` ${line.unit}` : ""}`
    const amount = line.quantity === null ? "" : ` = ${moneyText(lineAmount(line))} ${currency}`
    return `${i + 1}. ${line.name}${qty} × ${moneyText(line.unitPrice)} ${currency}${line.quantity === null && line.unit ? ` / ${line.unit}` : ""}${amount}`
  })
  const sums = lines.some((l) => l.quantity !== null)
    ? [`${w.subtotal}: ${moneyText(totals.subtotal)} ${currency}`, `${w.vat}: ${moneyText(totals.vatAmount)} ${currency}`, `${w.total}: ${moneyText(totals.totalAmount)} ${currency}`].join("\n")
    : ""
  const side = (label: string, party: { name: string; director: string | null }) => [label, party.name, party.director ? `${w.director}: ${party.director}` : ""].filter(Boolean).join("\n")
  return [
    `${w.title}\n${w.subtitle}`,
    [w.city, w.validity].filter(Boolean).join(" · "),
    w.intro,
    rows.join("\n"),
    sums,
    w.closing,
    side(w.sideA, facts.our),
    side(w.sideB, facts.counterparty),
  ]
    .filter((block) => block.trim().length > 0)
    .join("\n\n")
}
