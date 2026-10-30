import { dirname, join } from "node:path"
import { z } from "zod"

import { postOutboundResource } from "@/lib/integrations/webhook-url-guard"
import { parseZeytunBalanceConfig, zeytunBalanceScopeKey } from "@/lib/voice-agent/pharmacy/zeytun-balance-client"
import { ZEYTUN_CONNECTION_FILE } from "@/lib/voice-agent/pharmacy/zeytun-catalog-refresh"
import { readPrivate } from "@/lib/voice-agent/pharmacy/zeytun-private-file"

/**
 * A confirmed phone order as Zeytun's 1C «Заказ покупателя» (owner,
 * 2026-10-30: «давай с нашей стороны сделаем»). The contract is
 * docs/zeytun-1c-create-order-request.md: CreateOrder writes and posts the
 * document at once, 1C answers a repeat of the same ВнешнийИД with the
 * document it already has, and OrderStatus says whether an order is there.
 *
 * The connection is one more private file beside the line's grant. Without it
 * nothing here runs and «Подтвердить» works as before; the warehouse and METRO
 * come from the catalog's own connection, so an order goes to the warehouse
 * its prices were read from. Only HTTPS: the document is posted on arrival.
 */
export const ZEYTUN_ORDERS_CONNECTION_FILE = "zeytun-1c-orders.json"

const connectionSchema = z.strictObject({
  organizationId: z.string().trim().min(1).max(128),
  createEndpoint: z.url(),
  statusEndpoint: z.url(),
  username: z.string().min(1).max(256).regex(/^[^:\r\n]+$/),
  password: z.string().min(1).max(1024).regex(/^[^\r\n]+$/),
})

export type ErpConnection = {
  createEndpoint: string; statusEndpoint: string; authorization: string
  warehouse: string; metro: boolean; catalogScopeKey: string
}

export class ErpConnectionError extends Error {
  constructor() { super("erp_connection_invalid"); this.name = "ErpConnectionError" }
}

function httpsOnly(raw: string) {
  const url = new URL(raw)
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new ErpConnectionError()
  return url.toString()
}

async function readOptional(path: string): Promise<unknown | null> {
  try { return await readPrivate(path, 16_384) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw new ErpConnectionError()
  }
}

/**
 * The 1C order connection of this organization: null when there is none (the
 * file is absent, or names another organization), ErpConnectionError when the
 * file is there but cannot be used — then a confirm must not quietly skip 1C.
 */
export async function erpConnection(orgId: string, grantFile = process.env.ZEYTUN_INBOUND_PILOT_FILE): Promise<ErpConnection | null> {
  if (!grantFile) return null
  const raw = await readOptional(join(dirname(grantFile), ZEYTUN_ORDERS_CONNECTION_FILE))
  if (raw === null) return null
  const parsed = connectionSchema.safeParse(raw)
  if (!parsed.success) throw new ErpConnectionError()
  if (parsed.data.organizationId !== orgId) return null
  const catalog = await readOptional(join(dirname(grantFile), ZEYTUN_CONNECTION_FILE))
  if (catalog === null) throw new ErpConnectionError()
  let balance
  try { balance = parseZeytunBalanceConfig(catalog) } catch { throw new ErpConnectionError() }
  if (balance.organizationId !== orgId) throw new ErpConnectionError()
  const { username, password } = parsed.data
  return {
    createEndpoint: httpsOnly(parsed.data.createEndpoint), statusEndpoint: httpsOnly(parsed.data.statusEndpoint),
    authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
    warehouse: balance.request.Warehouse, metro: balance.request.METRO, catalogScopeKey: zeytunBalanceScopeKey(catalog),
  }
}

/* ─── Request ─────────────────────────────────────────────────────── */

export type ErpOrderInput = {
  id: string; label: string; callStartedAt: Date; pharmacyGuid: string; confirmedBy: string
  lines: Array<{ externalId: string; quantity: number; unitPrice: string }>
}

/** 1C's own stamp: ГГГГММДДччммсс, Baku time. */
export function bakuStamp(at: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(at).map(part => [part.type, part.value]))
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`
}

export function erpOrderPayload(order: ErpOrderInput, connection: Pick<ErpConnection, "warehouse" | "metro">) {
  return {
    ВнешнийИД: order.id,
    ВнешнийНомер: order.label,
    GUID: order.pharmacyGuid,
    METRO: connection.metro,
    Warehouse: connection.warehouse,
    Дата: bakuStamp(order.callStartedAt),
    Комментарий: `Телефонный заказ ${order.label}. Подтвердил: ${order.confirmedBy}`.slice(0, 500),
    Товары: order.lines.map(line => ({ Номенклатура: line.externalId, Количество: line.quantity, Цена: Number(line.unitPrice) })),
  }
}

/* ─── Answers ─────────────────────────────────────────────────────── */

const number = z.union([z.number().finite(), z.string().trim().regex(/^-?\d+(?:[.,]\d+)?$/).transform(value => Number(value.replace(",", ".")))])
const code = (value: number) => z.union([z.literal(value), z.literal(String(value))])
const documentSchema = z.object({
  Guid: z.string().trim().min(1).max(64), Номер: z.string().trim().min(1).max(64),
  Дата: z.string().trim().max(32).optional(), Сумма: number.optional(),
})
const goodsSchema = z.array(z.object({
  Номенклатура: z.string().trim().min(1).max(64), Количество: number, Цена: number.optional(), Сумма: number.optional(),
})).max(500)
const createAnswer = z.union([
  z.object({ code: code(0), data: z.object({ Создан: z.boolean(), Документ: documentSchema, Товары: goodsSchema.optional() }) }),
  z.object({ code: code(1), Ошибки: z.array(z.object({
    Код: z.string().trim().min(1).max(64), Номенклатура: z.string().trim().max(64).nullish(), Текст: z.string().max(2000).nullish(),
  })).min(1).max(500) }),
])
const statusAnswer = z.object({ code: code(0), data: z.union([
  z.object({ Найден: z.literal(true), Документ: documentSchema, Товары: goodsSchema.optional() }),
  z.object({ Найден: z.literal(false) }),
]) })

export type ErpDocument = { guid: string; number: string; date: string | null; total: string | null; existing: boolean }
export type ErpGoods = Array<{ externalId: string; quantity: number; price: number | null }>
export type ErpError = { code: string; externalId: string | null; text: string | null }
export type ErpOutcome =
  | { kind: "created"; document: ErpDocument; goods: ErpGoods }
  | { kind: "refused"; errors: ErpError[] }
  /** Nothing definite came back: the document may or may not be in 1C. */
  | { kind: "unknown"; error: string }

type Post = typeof postOutboundResource

async function call(connection: ErpConnection, endpoint: string, body: unknown, post: Post) {
  try {
    const response = await post(endpoint, {
      allowedHosts: [new URL(endpoint).hostname],
      maxRedirects: 0,
      // A posted document is quick next to the 29 s catalog read. Two calls at
      // most per click keep the manager's request under the proxy's minute.
      timeoutMs: 20_000,
      maxBodyBytes: 256 * 1024,
      maxResponseBytes: 1024 * 1024,
      body: JSON.stringify(body),
      headers: { Accept: "application/json", "Content-Type": "application/json", "Accept-Encoding": "identity",
        Authorization: connection.authorization },
    })
    // Refused at the door: the request never reached the method.
    if (response.status === 401 || response.status === 403) return { ok: false as const, definite: true, error: `http_${response.status}` }
    if (response.status !== 200) return { ok: false as const, definite: false, error: `http_${response.status}` }
    try { return { ok: true as const, json: JSON.parse(Buffer.from(response.bodyBytes).toString("utf8")) as unknown } }
    catch { return { ok: false as const, definite: false, error: "invalid_response" } }
  } catch {
    return { ok: false as const, definite: false, error: "no_answer" }
  }
}

const created = (document: z.infer<typeof documentSchema>, goods: z.infer<typeof goodsSchema> | undefined, existing: boolean): ErpOutcome => ({
  kind: "created",
  document: { guid: document.Guid, number: document.Номер, date: document.Дата ?? null,
    total: document.Сумма === undefined ? null : document.Сумма.toFixed(2), existing },
  goods: (goods ?? []).map(row => ({ externalId: row.Номенклатура.toLowerCase(), quantity: row.Количество, price: row.Цена ?? null })),
})

export async function createErpOrder(connection: ErpConnection, payload: ReturnType<typeof erpOrderPayload>,
  post: Post = postOutboundResource): Promise<ErpOutcome> {
  const answer = await call(connection, connection.createEndpoint, payload, post)
  if (!answer.ok) {
    // 401/403 wrote nothing; refuse with it so the manager is not told "maybe".
    return answer.definite ? { kind: "refused", errors: [{ code: answer.error, externalId: null, text: null }] } : { kind: "unknown", error: answer.error }
  }
  const parsed = createAnswer.safeParse(answer.json)
  if (!parsed.success) return { kind: "unknown", error: "invalid_response" }
  if ("data" in parsed.data) return created(parsed.data.data.Документ, parsed.data.data.Товары, !parsed.data.data.Создан)
  return { kind: "refused", errors: parsed.data.Ошибки.map(error => ({ code: error.Код, externalId: error.Номенклатура?.toLowerCase() || null,
    text: error.Текст?.trim().slice(0, 300) || null })) }
}

export type ErpStatus = ErpOutcome | { kind: "absent" }

export async function erpOrderStatus(connection: ErpConnection, orderId: string, post: Post = postOutboundResource): Promise<ErpStatus> {
  const answer = await call(connection, connection.statusEndpoint, { ВнешнийИД: orderId }, post)
  if (!answer.ok) return { kind: "unknown", error: answer.error }
  const parsed = statusAnswer.safeParse(answer.json)
  if (!parsed.success) return { kind: "unknown", error: "invalid_response" }
  return parsed.data.data.Найден ? created(parsed.data.data.Документ, parsed.data.data.Товары, true) : { kind: "absent" }
}

/**
 * Sends a confirmed order once, in two calls at most. After an earlier attempt
 * that got no clear answer, 1C is asked first; a first create that gets no
 * clear answer is followed by one question. A document can never be doubled: 1C keys it by
 * ВнешнийИД, and CRM never resends lines a manager changed after "maybe".
 */
export async function sendErpOrder(connection: ErpConnection, payload: ReturnType<typeof erpOrderPayload>,
  askFirst: boolean, post: Post = postOutboundResource): Promise<ErpOutcome> {
  if (askFirst) {
    const status = await erpOrderStatus(connection, payload.ВнешнийИД, post)
    if (status.kind !== "absent") return status
    return createErpOrder(connection, payload, post)
  }
  const outcome = await createErpOrder(connection, payload, post)
  if (outcome.kind !== "unknown") return outcome
  const status = await erpOrderStatus(connection, payload.ВнешнийИД, post)
  return status.kind === "created" ? status : outcome
}

/** Where 1C wrote something else than was sent: the manager sees it on the card. */
export function erpDifferences(sent: Array<{ position: number; externalId: string; quantity: number; unitPrice: string }>, goods: ErpGoods) {
  if (!goods.length) return []
  return sent.flatMap(line => {
    const row = goods.find(item => item.externalId === line.externalId.toLowerCase())
    if (!row) return [{ position: line.position, sentQuantity: line.quantity, quantity: 0, sentPrice: line.unitPrice, price: null }]
    const priceMoved = row.price !== null && Math.abs(row.price - Number(line.unitPrice)) >= 0.005
    if (row.quantity === line.quantity && !priceMoved) return []
    return [{ position: line.position, sentQuantity: line.quantity, quantity: row.quantity, sentPrice: line.unitPrice,
      price: row.price === null ? null : row.price.toFixed(2) }]
  })
}
