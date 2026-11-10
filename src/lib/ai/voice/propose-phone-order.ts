import type { AuthResult } from "@/lib/api-auth"
import {
  callStillRunning,
  PhoneOrderError,
  phoneOrdersEnabled,
  searchPhoneOrderCatalog,
} from "@/lib/pharmacy-orders/orders"
import { readableProductName } from "@/lib/pharmacy-orders/product-label"
import { prisma } from "@/lib/prisma"
import { phoneOrderLabel } from "@/lib/voice-agent/pharmacy/phone-orders"
import type { AiVoiceActionType } from "./action-registry"

/**
 * Телефонный заказ голосом (этап 5, владелец 2026-11-10): слова модели —
 * в заказ, строку и товар каталога. Как и весь propose-resolve: модель даёт
 * только слова, id находит сервер под организацией; двусмысленность — вопрос,
 * а не догадка.
 *
 * Заказ — номером («1015», «TS-1015»), словами аптеки или открытый на экране.
 * Строка — номером или словами товара. Товар — поиском по каталогу 1С того же
 * заказа, тем же, что у выбора товара на карточке
 * (`searchPhoneOrderCatalog`); несколько подходящих — человек выбирает, и
 * модель зовёт снова с точным названием.
 */

export type PhoneOrderProposeTool =
  | "propose_change_phone_order_line"
  | "propose_add_phone_order_line"
  | "propose_remove_phone_order_line"
  | "propose_confirm_phone_order"
  | "propose_reject_phone_order"

export const PHONE_ORDER_TOOLS: ReadonlySet<string> = new Set<PhoneOrderProposeTool>([
  "propose_change_phone_order_line",
  "propose_add_phone_order_line",
  "propose_remove_phone_order_line",
  "propose_confirm_phone_order",
  "propose_reject_phone_order",
])

const ACTION_TYPES: Readonly<Record<PhoneOrderProposeTool, AiVoiceActionType>> = {
  propose_change_phone_order_line: "update_phone_order_line",
  propose_add_phone_order_line: "add_phone_order_line",
  propose_remove_phone_order_line: "remove_phone_order_line",
  propose_confirm_phone_order: "confirm_phone_order",
  propose_reject_phone_order: "reject_phone_order",
}

export type PhoneOrderClarifyCode =
  | "PHONE_ORDER_NOT_FOUND"
  | "PHONE_ORDER_AMBIGUOUS"
  | "PHONE_ORDER_TARGET_REQUIRED"
  | "PHONE_ORDER_LINE_NOT_FOUND"
  | "PHONE_ORDER_LINE_AMBIGUOUS"
  | "PRODUCT_NOT_FOUND"
  | "PRODUCT_AMBIGUOUS"

export type PhoneOrderResolution =
  | Readonly<{ kind: "resolved"; actionType: AiVoiceActionType; payload: Record<string, unknown> }>
  | Readonly<{
    kind: "clarify"
    code: PhoneOrderClarifyCode
    field: "order" | "line" | "product"
    candidates: readonly Readonly<{ id: string; label: string }>[]
  }>
  | Readonly<{ kind: "invalid"; issues: readonly Readonly<{ path: string; message: string }>[] }>

const MAX_CANDIDATES = 5

const AZ_FOLD: Readonly<Record<string, string>> = { "ə": "e", "ş": "s", "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ü": "u" }
// Менеджер говорит по-русски, а в заказе — латиница 1С и слова аптеки:
// «кетонал» и «Ketonal» — одно слово.
const CYRILLIC: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "q", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "c", ш: "s",
  щ: "s", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya",
}

/** Слова как набор букв: регистр, азербайджанские буквы и кириллица сведены. */
export function phoneOrderWords(text: string): string[] {
  return text
    .toLowerCase()
    .split("")
    .map((char) => AZ_FOLD[char] ?? CYRILLIC[char] ?? char)
    .join("")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // г и q — один звук в этих названиях («Гастал» / «Qastal»), как и к/k.
    .replace(/g/g, "q")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function containsAll(haystack: string, needle: string): boolean {
  const words = new Set(phoneOrderWords(haystack))
  const asked = phoneOrderWords(needle)
  return asked.length > 0 && asked.every((word) => [...words].some((have) => have.startsWith(word)))
}

type OrderRow = Readonly<{
  id: string
  number: number
  status: string
  revision: number
  providerCallId: string
  pharmacyName: string | null
  totalAmount: { toFixed(digits: number): string } | null
  currency: string | null
  company: { name: string } | null
}>

const ORDER_SELECT = {
  id: true, number: true, status: true, revision: true, providerCallId: true,
  pharmacyName: true, totalAmount: true, currency: true,
  company: { select: { name: true } },
} as const

function orderLabel(row: OrderRow): string {
  return [
    phoneOrderLabel(row.number),
    row.company?.name ?? row.pharmacyName,
    row.totalAmount ? `${row.totalAmount.toFixed(2)} ${row.currency ?? ""}`.trim() : null,
  ].filter(Boolean).join(" · ")
}

async function resolveOrder(
  auth: AuthResult,
  spoken: string | undefined,
  screenOrderId: string | undefined,
): Promise<Readonly<{ ok: true; order: OrderRow }> | Extract<PhoneOrderResolution, { kind: "clarify" }>> {
  const pending = { organizationId: auth.orgId, status: "pending_review" }
  if (spoken === undefined) {
    if (screenOrderId) {
      const order = await prisma.pharmacyPhoneOrder.findFirst({
        where: { id: screenOrderId, organizationId: auth.orgId },
        select: ORDER_SELECT,
      }) as OrderRow | null
      if (order) return { ok: true, order }
    }
    const waiting = await prisma.pharmacyPhoneOrder.findMany({
      where: pending, select: ORDER_SELECT, orderBy: { createdAt: "desc" }, take: MAX_CANDIDATES,
    }) as OrderRow[]
    return {
      kind: "clarify", code: "PHONE_ORDER_TARGET_REQUIRED", field: "order",
      candidates: waiting.map((row) => ({ id: row.id, label: orderLabel(row) })),
    }
  }
  const digits = spoken.replace(/\D/g, "")
  if (digits && /^\s*(?:ts[\s-]*)?\d+\s*$/i.test(spoken)) {
    const order = await prisma.pharmacyPhoneOrder.findFirst({
      where: { organizationId: auth.orgId, number: Number(digits) },
      select: ORDER_SELECT,
    }) as OrderRow | null
    if (order) return { ok: true, order }
    return { kind: "clarify", code: "PHONE_ORDER_NOT_FOUND", field: "order", candidates: [] }
  }
  // Словами аптеки — среди ждущих проверки: закрытый заказ голосом не правится.
  const waiting = await prisma.pharmacyPhoneOrder.findMany({
    where: pending, select: ORDER_SELECT, orderBy: { createdAt: "desc" }, take: 200,
  }) as OrderRow[]
  const matching = waiting.filter((row) => containsAll(`${row.company?.name ?? ""} ${row.pharmacyName ?? ""}`, spoken))
  if (matching.length === 1) return { ok: true, order: matching[0] }
  return {
    kind: "clarify",
    code: matching.length === 0 ? "PHONE_ORDER_NOT_FOUND" : "PHONE_ORDER_AMBIGUOUS",
    field: "order",
    candidates: matching.slice(0, MAX_CANDIDATES).map((row) => ({ id: row.id, label: orderLabel(row) })),
  }
}

type LineRow = Readonly<{
  id: string
  position: number
  productName: string | null
  sourceName: string | null
  spokenText: string
  quantity: number
  unit: string
}>

function lineLabel(row: LineRow): string {
  return `#${row.position} · ${row.productName ? readableProductName(row.productName) : row.spokenText} · ${row.quantity} ${row.unit}`
}

async function resolveLine(
  auth: AuthResult,
  orderId: string,
  spoken: string,
): Promise<Readonly<{ ok: true; line: LineRow }> | Extract<PhoneOrderResolution, { kind: "clarify" }>> {
  const lines = await prisma.pharmacyPhoneOrderLine.findMany({
    where: { orderId, organizationId: auth.orgId },
    select: { id: true, position: true, productName: true, sourceName: true, spokenText: true, quantity: true, unit: true },
    orderBy: { position: "asc" },
  }) as LineRow[]
  const number = /^\s*(?:#|№|n)?\s*(\d{1,3})\s*$/i.exec(spoken)
  const matching = number
    ? lines.filter((row) => row.position === Number(number[1]))
    : lines.filter((row) => containsAll(`${row.productName ?? ""} ${row.sourceName ?? ""} ${row.spokenText}`, spoken))
  if (matching.length === 1) return { ok: true, line: matching[0] }
  return {
    kind: "clarify",
    code: matching.length === 0 ? "PHONE_ORDER_LINE_NOT_FOUND" : "PHONE_ORDER_LINE_AMBIGUOUS",
    field: "line",
    // Что в заказе есть — чтобы спросить номером строки.
    candidates: (matching.length === 0 ? lines : matching).slice(0, 12).map((row) => ({ id: row.id, label: lineLabel(row) })),
  }
}

type CatalogItem = Awaited<ReturnType<typeof searchPhoneOrderCatalog>>["items"][number]

function sameName(a: string, b: string): boolean {
  return phoneOrderWords(a).join(" ") === phoneOrderWords(b).join(" ")
}

async function resolveProduct(
  auth: AuthResult,
  orderId: string,
  spoken: string,
): Promise<Readonly<{ ok: true; item: CatalogItem }> | PhoneOrderResolution> {
  let items: CatalogItem[]
  try {
    items = (await searchPhoneOrderCatalog(auth.orgId, orderId, spoken)).items
  } catch (error) {
    if (error instanceof PhoneOrderError) {
      return { kind: "invalid", issues: [{ path: "product", message: "The 1C catalog is not available right now; the product can be picked on the order card" }] }
    }
    throw error
  }
  const exact = items.filter((item) => sameName(item.name, spoken) || sameName(readableProductName(item.name), spoken)
    || sameName(item.sourceName, spoken))
  if (exact.length === 1) return { ok: true, item: exact[0] }
  if (items.length === 1) return { ok: true, item: items[0] }
  return {
    kind: "clarify",
    code: items.length === 0 ? "PRODUCT_NOT_FOUND" : "PRODUCT_AMBIGUOUS",
    field: "product",
    candidates: items.slice(0, MAX_CANDIDATES).map((item) => ({
      id: item.externalId,
      label: [readableProductName(item.name), item.price ? `${item.price.amount} / ${item.price.per}` : null].filter(Boolean).join(" · "),
    })),
  }
}

function productPayload(item: CatalogItem): Record<string, unknown> {
  return {
    externalId: item.externalId,
    itemCode: item.itemCode,
    productName: item.name,
    sourceName: item.sourceName,
    unitPrice: item.price?.amount ?? null,
  }
}

function invalid(path: string, message: string): PhoneOrderResolution {
  return { kind: "invalid", issues: [{ path, message }] }
}

export async function resolvePhoneOrderProposal(
  auth: AuthResult,
  tool: PhoneOrderProposeTool,
  args: Record<string, unknown>,
  screen: Readonly<{ recordType?: string; recordId?: string }>,
): Promise<PhoneOrderResolution> {
  if (!await phoneOrdersEnabled(auth.orgId)) {
    return invalid("order", "This organization has no phone orders")
  }
  const resolvedOrder = await resolveOrder(
    auth,
    typeof args.order === "string" ? args.order : undefined,
    screen.recordType === "phone_order" ? screen.recordId : undefined,
  )
  if (!("ok" in resolvedOrder)) return resolvedOrder
  const order = resolvedOrder.order
  if (order.status !== "pending_review") {
    return invalid("order", `Order ${phoneOrderLabel(order.number)} is already ${order.status === "confirmed" ? "confirmed" : "rejected"}; it can no longer change`)
  }
  if (await callStillRunning(auth.orgId, order.providerCallId)) {
    return invalid("order", `The pharmacy is still on the call for ${phoneOrderLabel(order.number)}; it can change only after the call ends`)
  }
  const base = { orderId: order.id, revision: order.revision }
  const actionType = ACTION_TYPES[tool]

  if (tool === "propose_confirm_phone_order") return { kind: "resolved", actionType, payload: base }
  if (tool === "propose_reject_phone_order") {
    return { kind: "resolved", actionType, payload: { ...base, reason: args.reason } }
  }
  if (tool === "propose_add_phone_order_line") {
    const product = await resolveProduct(auth, order.id, String(args.product))
    if (!("ok" in product)) return product
    return {
      kind: "resolved",
      actionType,
      payload: {
        ...base,
        ...productPayload(product.item),
        quantity: args.quantity,
        // Слово единицы — как сказали; не сказали — единица цены 1С.
        unit: (typeof args.unit === "string" ? args.unit : product.item.price?.per || "qutu").toLowerCase(),
      },
    }
  }

  const line = await resolveLine(auth, order.id, String(args.line))
  if (!("ok" in line)) return line
  if (tool === "propose_remove_phone_order_line") {
    return { kind: "resolved", actionType, payload: { ...base, lineId: line.line.id } }
  }
  if (args.product === undefined && args.quantity === undefined) {
    return invalid("(root)", "Name a new quantity or a new product for the line")
  }
  const payload: Record<string, unknown> = { ...base, lineId: line.line.id }
  if (typeof args.product === "string") {
    const product = await resolveProduct(auth, order.id, args.product)
    if (!("ok" in product)) return product
    Object.assign(payload, productPayload(product.item))
  }
  if (typeof args.quantity === "number") payload.quantity = args.quantity
  return { kind: "resolved", actionType, payload }
}
