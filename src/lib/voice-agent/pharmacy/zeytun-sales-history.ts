import type { PrismaClient } from "@prisma/client"
import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"
import { TextDecoder } from "node:util"
import { SaxesParser } from "saxes"
import { z } from "zod"

import { postOutboundResource } from "../../integrations/webhook-url-guard"
import { runWithTenant } from "../../rls-context"
import { ZEYTUN_CLIENTS_CONNECTION_FILE } from "./zeytun-catalog-refresh"
import { parseZeytunClientsConfig, zeytunClientsScopeKey } from "./zeytun-clients-client"
import { ZeytunClientsDirectory } from "./zeytun-clients-directory"
import type { AssortmentSource } from "./zeytun-pharmacy-assortment"
import { readPrivate } from "./zeytun-private-file"
import { ZeytunSnapshotStore } from "./zeytun-snapshot-store"

/**
 * What a pharmacy buys from Zeytun, as 1C's own sales say (owner 2026-11-11:
 * «Да, подключай»; Zeytun's programmer documented Get_Sales the same day).
 * Until now the line knew a pharmacy's products only from the phone orders its
 * managers confirmed in the CRM: a few. 1C has every sale: a large pharmacy has
 * ~90 a month, each with its products.
 *
 * Get_Sales (SOAP, `GetSales`, operation `Sales`) answers two questions:
 * - `TypeOperation = "Взаиморасчеты"`: the pharmacy's settlement documents, one
 *   row each (registrar text with the document number, period). `Date` must be a
 *   date: 1C's empty one, 0001-01-01, gives the whole list; "" is refused.
 * - `TypeOperation = "Реализация"` and `CodeSales = <number>`: one sale, its
 *   products (`ГуидНоменклатуры` = the catalog's product GUID) and quantities.
 *
 * A background job (POST /api/cron/zeytun-sales-history, the jobs process)
 * reads the sales of the last HISTORY_DAYS per pharmacy, one request at a
 * time inside a time budget, and keeps per pharmacy only which products each
 * sale held: no prices, no sums. The line reads that file when a call starts
 * (salesHistorySource) and never calls 1C itself.
 */

export const ZEYTUN_SALES_CONNECTION_FILE = "zeytun-1c-sales.json"
/** Sales older than this are dropped: what a pharmacy buys now, not two years ago. */
export const HISTORY_DAYS = 180
/** The most sales kept per pharmacy, the newest. */
const MAX_DOCS = 500
const DAY_MS = 24 * 60 * 60_000
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024
const MAX_FILE_BYTES = 2 * 1024 * 1024

const SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
const SERVICE = "GetSales"
const CORE = "http://v8.1c.ru/8.1/data/core"
const XSI = "http://www.w3.org/2001/XMLSchema-instance"
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const EMPTY_GUID = "00000000-0000-0000-0000-000000000000"
/** A sale's number as 1C writes it ("ZN002988985"): it goes back into a request, so letters and digits only. */
const DOC_NUMBER = /^[0-9A-Za-zА-Яа-я]{3,32}$/u
const SALE_REGISTRAR = /^Реализация товаров и услуг\s+(\S+)\s+от\s/u

// ---- Connection ----

const configSchema = z.strictObject({
  organizationId: z.string().trim().min(1).max(128), endpoint: z.url(),
  username: z.string().min(1).max(256).regex(/^[^:\r\n]+$/),
  password: z.string().min(1).max(1024).regex(/^[^\r\n]+$/),
  allowPlainHttp: z.boolean().default(false),
})
export type ZeytunSalesConfig = z.infer<typeof configSchema>

export class ZeytunSalesReadError extends Error {
  constructor(readonly code: "invalid_configuration" | "https_required" | "authentication_required" | "upstream_unavailable" | "invalid_response") {
    super(code); this.name = "ZeytunSalesReadError"
  }
}

export function parseZeytunSalesConfig(input: unknown): ZeytunSalesConfig {
  const result = configSchema.safeParse(input)
  if (!result.success) throw new ZeytunSalesReadError("invalid_configuration")
  const url = new URL(result.data.endpoint)
  if (url.username || url.password || url.hash || url.search || !["http:", "https:"].includes(url.protocol)) {
    throw new ZeytunSalesReadError("invalid_configuration")
  }
  if (url.protocol === "http:" && !result.data.allowPlainHttp) throw new ZeytunSalesReadError("https_required")
  return { ...result.data, endpoint: url.toString() }
}

// ---- 1C's answer: a ValueTable inside a SOAP string ----

export type Cell = string | null | ValueTable
export type ValueTable = { columns: string[]; rows: Cell[][] }

/** The `return` string of a GetSales SalesResponse; namespace-aware, no DTD or entities. */
export function decodeSalesSoap(payload: Uint8Array): string {
  try {
    if (!payload.byteLength || payload.byteLength > MAX_RESPONSE_BYTES) throw new Error()
    const xml = new TextDecoder("utf-8", { fatal: true }).decode(payload)
    if (/<!DOCTYPE|<!ENTITY/.test(xml)) throw new Error()
    const parser = new SaxesParser({ xmlns: true })
    const expected = [[SOAP, "Envelope"], [SOAP, "Body"], [SERVICE, "SalesResponse"], [SERVICE, "return"]]
    let depth = 0, opened = 0
    const parts: string[] = []
    parser.on("error", () => { throw new Error() })
    parser.on("doctype", () => { throw new Error() })
    parser.on("processinginstruction", () => { throw new Error() })
    parser.on("opentag", (tag) => {
      if (opened !== depth || depth >= expected.length || tag.uri !== expected[depth][0] || tag.local !== expected[depth][1]) throw new Error()
      depth++; opened++
    })
    parser.on("closetag", () => { depth-- })
    const text = (value: string) => {
      if (depth === 4) parts.push(value)
      else if (value.trim()) throw new Error()
    }
    parser.on("text", text)
    parser.on("cdata", text)
    parser.write(xml).close()
    if (opened !== 4 || depth !== 0) throw new Error()
    return parts.join("")
  } catch {
    // An XML error can quote a customer's record: never propagate it.
    throw new ZeytunSalesReadError("invalid_response")
  }
}

/** 1C's ValueTable XML (http://v8.1c.ru/8.1/data/core), nested tables included. */
export function parseValueTable(xml: string): ValueTable {
  try {
    if (/<!DOCTYPE|<!ENTITY/.test(xml)) throw new Error()
    type Frame =
      | { kind: "table"; table: ValueTable; set?: (table: ValueTable) => void }
      | { kind: "column" | "row" | "skip" }
      | { kind: "name" | "value"; text: string[]; nil: boolean; set: (value: string | null) => void }
    const stack: Frame[] = []
    let root: ValueTable | null = null
    const parser = new SaxesParser({ xmlns: true })
    parser.on("error", () => { throw new Error() })
    parser.on("doctype", () => { throw new Error() })
    parser.on("processinginstruction", () => { throw new Error() })
    parser.on("opentag", (tag) => {
      const top = stack.at(-1)
      if (!top) {
        if (root || tag.uri !== CORE || tag.local !== "ValueTable") throw new Error()
        root = { columns: [], rows: [] }
        stack.push({ kind: "table", table: root })
        return
      }
      if (top.kind === "skip" || top.kind === "name" || top.kind === "value") {
        if (top.kind !== "skip") throw new Error()
        stack.push({ kind: "skip" }); return
      }
      if (tag.uri !== CORE) throw new Error()
      if (top.kind === "table" && tag.local === "column") { stack.push({ kind: "column" }); return }
      if (top.kind === "table" && tag.local === "row") { top.table.rows.push([]); stack.push({ kind: "row" }); return }
      if (top.kind === "column" && tag.local === "Name") {
        const table = (stack.at(-2) as { table: ValueTable }).table
        stack.push({ kind: "name", text: [], nil: false, set: (value) => table.columns.push(value ?? "") })
        return
      }
      if (top.kind === "column") { stack.push({ kind: "skip" }); return }
      if (top.kind === "row" && tag.local === "Value") {
        const table = (stack.at(-2) as { table: ValueTable }).table
        const row = table.rows.at(-1)!
        const xsiType = Object.values(tag.attributes).find(attr => attr.uri === XSI && attr.local === "type")?.value ?? ""
        const nil = Object.values(tag.attributes).some(attr => attr.uri === XSI && attr.local === "nil" && attr.value === "true")
        if (xsiType === "ValueTable" || xsiType.endsWith(":ValueTable")) {
          const nested: ValueTable = { columns: [], rows: [] }
          row.push(nested)
          stack.push({ kind: "table", table: nested })
          return
        }
        const index = row.length
        row.push(null)
        stack.push({ kind: "value", text: [], nil, set: (value) => { row[index] = value } })
        return
      }
      throw new Error()
    })
    const text = (value: string) => {
      const top = stack.at(-1)
      if (top && (top.kind === "name" || top.kind === "value")) top.text.push(value)
    }
    parser.on("text", text)
    parser.on("cdata", text)
    parser.on("closetag", () => {
      const top = stack.pop()
      if (top && (top.kind === "name" || top.kind === "value")) top.set(top.nil ? null : top.text.join(""))
    })
    parser.write(xml).close()
    if (!root || stack.length) throw new Error()
    return root
  } catch {
    throw new ZeytunSalesReadError("invalid_response")
  }
}

/** The table's rows as objects by column name. */
export function tableRows(table: ValueTable): Array<Record<string, Cell>> {
  return table.rows.map(row => Object.fromEntries(table.columns.map((name, index) => [name, row[index] ?? null])))
}

export type SaleRef = { number: string; date: string }

/** The pharmacy's sales among its settlement documents, newest first. */
export function salesFromSettlements(table: ValueTable): SaleRef[] {
  const sales = new Map<string, SaleRef>()
  for (const row of tableRows(table)) {
    const registrar = row["Регистратор"], period = row["Период"]
    if (typeof registrar !== "string" || typeof period !== "string") continue
    const number = SALE_REGISTRAR.exec(registrar.trim())?.[1]
    const at = Date.parse(period.endsWith("Z") || /[+-]\d\d:\d\d$/.test(period) ? period : `${period}Z`)
    if (!number || !DOC_NUMBER.test(number) || !Number.isFinite(at)) continue
    sales.set(number, { number, date: new Date(at).toISOString().slice(0, 10) })
  }
  return [...sales.values()].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))
}

/** The product GUIDs one sale held (quantity above zero); null when 1C did not return that sale. */
export function productsOfSale(table: ValueTable, number: string): string[] | null {
  const doc = tableRows(table).find(row => row["НомерДокумента"] === number)
  const goods = doc?.["ТаблицаТоваров"]
  if (!doc || !goods || typeof goods !== "object") return null
  const ids = new Set<string>()
  for (const line of tableRows(goods)) {
    const id = typeof line["ГуидНоменклатуры"] === "string" ? line["ГуидНоменклатуры"].trim().toLowerCase() : ""
    const quantity = typeof line["Количество"] === "string" ? Number(line["Количество"]) : NaN
    if (GUID.test(id) && id !== EMPTY_GUID && quantity > 0) ids.add(id)
  }
  return [...ids]
}

// ---- Requests ----

export type SalesFetch = typeof postOutboundResource

function salesRequest(params: Array<[string, string]>) {
  const inner = params.map(([name, value]) => `<g:${name}>${value}</g:${name}>`).join("")
  return '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soap:Envelope xmlns:soap="${SOAP}" xmlns:g="${SERVICE}"><soap:Body><g:Sales>${inner}</g:Sales></soap:Body></soap:Envelope>`
}

async function askSales(config: ZeytunSalesConfig, params: Array<[string, string]>, download: SalesFetch): Promise<ValueTable> {
  let response: Awaited<ReturnType<SalesFetch>>
  try {
    response = await download(config.endpoint, {
      allowHttp: config.allowPlainHttp, allowedHosts: [new URL(config.endpoint).hostname],
      maxRedirects: 0, timeoutMs: 60_000, maxBodyBytes: 4096, maxResponseBytes: MAX_RESPONSE_BYTES,
      body: salesRequest(params),
      headers: {
        Accept: "text/xml", "Content-Type": "text/xml; charset=utf-8", "Accept-Encoding": "identity",
        SOAPAction: `"${SERVICE}#${SERVICE}:Sales"`,
        Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`, "utf8").toString("base64")}`,
      },
    })
  } catch { throw new ZeytunSalesReadError("upstream_unavailable") }
  if (response.status === 401 || response.status === 403) throw new ZeytunSalesReadError("authentication_required")
  if (response.status !== 200) throw new ZeytunSalesReadError("upstream_unavailable")
  return parseValueTable(decodeSalesSoap(response.bodyBytes))
}

export function readSettlements(config: ZeytunSalesConfig, pharmacyGuid: string, download: SalesFetch = postOutboundResource) {
  if (!GUID.test(pharmacyGuid)) throw new ZeytunSalesReadError("invalid_configuration")
  return askSales(config, [["NodeCode", ""], ["GuidClient", pharmacyGuid], ["Date", "0001-01-01T00:00:00"],
    ["CodeSales", ""], ["TypeOperation", "Взаиморасчеты"]], download).then(salesFromSettlements)
}

export function readSale(config: ZeytunSalesConfig, pharmacyGuid: string, number: string, download: SalesFetch = postOutboundResource) {
  if (!GUID.test(pharmacyGuid) || !DOC_NUMBER.test(number)) throw new ZeytunSalesReadError("invalid_configuration")
  return askSales(config, [["NodeCode", ""], ["GuidClient", pharmacyGuid], ["Date", "0001-01-01T00:00:00"],
    ["CodeSales", number], ["TypeOperation", "Реализация"]], download).then(table => productsOfSale(table, number))
}

// ---- Storage: one private file per pharmacy ----

const historySchema = z.strictObject({
  format: z.literal(1),
  pharmacy: z.string().regex(GUID),
  /** Product GUIDs; a sale names them by index. */
  items: z.array(z.string().regex(GUID)).max(20_000),
  sales: z.array(z.strictObject({ n: z.string().regex(DOC_NUMBER), d: z.string().regex(/^\d{4}-\d\d-\d\d$/), i: z.array(z.number().int().nonnegative()) }))
    .max(MAX_DOCS),
})
type StoredHistory = z.infer<typeof historySchema>
export type PharmacySales = Map<string, { date: string; products: string[] }>

const indexSchema = z.record(z.string().regex(GUID), z.strictObject({ at: z.number().int().nonnegative(), complete: z.boolean() }))
type HistoryIndex = z.infer<typeof indexSchema>

export class SalesHistoryStore {
  readonly root: string
  constructor(cacheDir: string, organizationId: string) {
    if (!isAbsolute(cacheDir) || !organizationId.trim() || organizationId.length > 128) throw new Error("invalid_sales_history_root")
    this.root = join(cacheDir, `sales-history-${createHash("sha256").update(organizationId).digest("hex").slice(0, 24)}`)
  }

  async load(pharmacyGuid: string): Promise<PharmacySales | null> {
    if (!GUID.test(pharmacyGuid)) return null
    let raw: unknown
    try { raw = await readPrivate(join(this.root, `${pharmacyGuid}.json`), MAX_FILE_BYTES) } catch { return null }
    const parsed = historySchema.safeParse(raw)
    if (!parsed.success || parsed.data.pharmacy !== pharmacyGuid) return null
    const { items } = parsed.data
    return new Map(parsed.data.sales.map(sale => [sale.n, { date: sale.d, products: sale.i.map(index => items[index]).filter(Boolean) }]))
  }

  async save(pharmacyGuid: string, sales: PharmacySales): Promise<void> {
    const items: string[] = [], index = new Map<string, number>()
    const stored: StoredHistory = { format: 1, pharmacy: pharmacyGuid, items, sales: [] }
    for (const [n, sale] of [...sales].sort(([, a], [, b]) => b.date.localeCompare(a.date)).slice(0, MAX_DOCS)) {
      stored.sales.push({ n, d: sale.date, i: sale.products.map(id => {
        let at = index.get(id)
        if (at === undefined) { at = items.length; items.push(id); index.set(id, at) }
        return at
      }) })
    }
    await this.write(`${pharmacyGuid}.json`, JSON.stringify(stored))
  }

  async loadIndex(): Promise<HistoryIndex> {
    try { return indexSchema.parse(await readPrivate(join(this.root, "index.json"), MAX_FILE_BYTES)) } catch { return {} }
  }

  saveIndex(index: HistoryIndex): Promise<void> { return this.write("index.json", JSON.stringify(index)) }

  private async write(name: string, body: string): Promise<void> {
    await mkdir(dirname(join(this.root, name)), { recursive: true, mode: 0o700 })
    const dir = await lstat(this.root)
    if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077)) throw new Error("private_directory_required")
    const temporary = join(this.root, `.${name}.${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try { await handle.writeFile(body); await handle.sync() } finally { await handle.close() }
      await rename(temporary, join(this.root, name))
    } finally { await unlink(temporary).catch(() => undefined) }
  }
}

/** Products by how many recent sales held them, the most recent first on a tie. */
export function rankSalesProducts(sales: PharmacySales, now = Date.now()): string[] {
  const since = new Date(now - HISTORY_DAYS * DAY_MS).toISOString().slice(0, 10)
  const counts = new Map<string, { count: number; last: string }>()
  for (const sale of sales.values()) {
    if (sale.date < since) continue
    for (const id of sale.products) {
      const known = counts.get(id)
      if (!known) counts.set(id, { count: 1, last: sale.date })
      else { known.count++; if (sale.date > known.last) known.last = sale.date }
    }
  }
  return [...counts].sort(([a, x], [b, y]) => y.count - x.count || y.last.localeCompare(x.last) || a.localeCompare(b)).map(([id]) => id)
}

/** The line's source (zeytun-pharmacy-assortment.ts): the calling pharmacy's 1C sales, as the job stored them. */
export function salesHistorySource(cacheDir: string, clock: () => number = Date.now): AssortmentSource {
  return {
    name: "1c_sales",
    async products({ organizationId, pharmacy }) {
      if (!cacheDir || !pharmacy.guid) return []
      const sales = await new SalesHistoryStore(cacheDir, organizationId).load(pharmacy.guid)
      return sales ? rankSalesProducts(sales, clock()) : []
    },
  }
}

// ---- The job ----

/** A pharmacy that called the line recently is re-read this often; any other, this often. */
const CALLER_EVERY_MS = 6 * 60 * 60_000
const OTHER_EVERY_MS = 3 * DAY_MS
const CALLERS_SINCE_MS = 90 * DAY_MS
const TRUSTED_IDENTIFICATION = ["phone_unique", "phone_shared", "manager_selected"]

type Env = { grantFile?: string; cacheDir?: string }
export type SalesHistoryRun = {
  outcome: "not_configured" | "busy" | "done" | "failed"
  error?: ZeytunSalesReadError["code"]
  pharmacies?: number; sales?: number; due?: number; failures?: number
}

let running = false

/**
 * One tick: the due pharmacies, line callers first, then every other pharmacy
 * of 1C's directory, the longest unread first, until the budget runs out. One
 * request at a time: 1C is Zeytun's working system. A pharmacy cut off by the
 * budget keeps what was read and goes on next tick.
 */
export async function refreshZeytunSalesHistory(input: {
  db: PrismaClient; env?: Env; now?: () => number; budgetMs?: number; download?: SalesFetch
}): Promise<SalesHistoryRun> {
  const env = input.env ?? { grantFile: process.env.ZEYTUN_INBOUND_PILOT_FILE, cacheDir: process.env.ZEYTUN_CACHE_DIR }
  const now = input.now ?? Date.now
  if (!env.grantFile || !env.cacheDir) return { outcome: "not_configured" }
  let raw: unknown
  try { raw = await readPrivate(join(dirname(env.grantFile), ZEYTUN_SALES_CONNECTION_FILE), 16_384) }
  catch { return { outcome: "not_configured" } }
  const config = parseZeytunSalesConfig(raw)
  if (running) return { outcome: "busy" }
  running = true
  try {
    const started = now(), budget = input.budgetMs ?? 120_000
    const store = new SalesHistoryStore(env.cacheDir, config.organizationId)
    const index = await store.loadIndex()
    const callers = await lineCallers(input.db, config.organizationId, started)
    const others = await directoryPharmacies(env, config.organizationId)
    const due = (guid: string, every: number) => { const seen = index[guid]; return !seen || !seen.complete || started - seen.at >= every }
    const queue = [...new Set([
      ...callers.filter(guid => due(guid, CALLER_EVERY_MS)),
      ...others.filter(guid => !callers.includes(guid) && due(guid, OTHER_EVERY_MS))
        .sort((a, b) => (index[a]?.at ?? 0) - (index[b]?.at ?? 0)),
    ])]
    let pharmacies = 0, sales = 0, failures = 0
    for (const guid of queue) {
      if (now() - started >= budget) break
      try {
        const read = await refreshPharmacy(config, store, guid, started, () => now() - started < budget, input.download)
        sales += read.fetched
        index[guid] = { at: started, complete: read.complete }
        pharmacies++
      } catch (error) {
        failures++
        // Credentials refused or 1C down: the rest would fail the same way.
        if (error instanceof ZeytunSalesReadError && error.code !== "invalid_response") {
          await store.saveIndex(index)
          return { outcome: "failed", error: error.code, pharmacies, sales, due: queue.length, failures }
        }
        index[guid] = { at: started, complete: true }
      }
    }
    await store.saveIndex(index)
    return { outcome: "done", pharmacies, sales, due: queue.length, failures }
  } finally { running = false }
}

async function refreshPharmacy(config: ZeytunSalesConfig, store: SalesHistoryStore, guid: string, now: number,
  inBudget: () => boolean, download?: SalesFetch): Promise<{ fetched: number; complete: boolean }> {
  const since = new Date(now - HISTORY_DAYS * DAY_MS).toISOString().slice(0, 10)
  const listed = (await readSettlements(config, guid, download)).filter(sale => sale.date >= since).slice(0, MAX_DOCS)
  const known = await store.load(guid) ?? new Map()
  // 1C's list is the truth: a sale no longer in it (unposted, deleted) goes.
  const kept: PharmacySales = new Map(listed.filter(sale => known.has(sale.number)).map(sale => [sale.number, { ...known.get(sale.number)!, date: sale.date }]))
  let fetched = 0, complete = true
  for (const sale of listed) {
    if (kept.has(sale.number)) continue
    if (!inBudget()) { complete = false; break }
    const products = await readSale(config, guid, sale.number, download)
    fetched++
    if (products) kept.set(sale.number, { date: sale.date, products })
  }
  await store.save(guid, kept)
  return { fetched, complete }
}

/** The 1C pharmacies of the line's recent trusted calls, the latest first. */
async function lineCallers(db: PrismaClient, organizationId: string, now: number): Promise<string[]> {
  const rows = await runWithTenant(organizationId, () => db.pharmacyPhoneOrder.findMany({
    where: { organizationId, pharmacyGuid: { not: null }, pharmacyIdentification: { in: TRUSTED_IDENTIFICATION },
      createdAt: { gte: new Date(now - CALLERS_SINCE_MS) } },
    select: { pharmacyGuid: true }, orderBy: { createdAt: "desc" }, take: 2000,
  }))
  return [...new Set(rows.map(row => row.pharmacyGuid!.toLowerCase()).filter(guid => GUID.test(guid)))]
}

/** Every pharmacy of the stored 1C directory (ListClients); none without it. */
async function directoryPharmacies(env: Env, organizationId: string): Promise<string[]> {
  try {
    const clients = parseZeytunClientsConfig(await readPrivate(join(dirname(env.grantFile!), ZEYTUN_CLIENTS_CONNECTION_FILE), 16_384))
    if (clients.organizationId !== organizationId) return []
    const saved = await new ZeytunSnapshotStore(env.cacheDir!, clients.organizationId, zeytunClientsScopeKey(clients)).load()
    if (!saved) return []
    return new ZeytunClientsDirectory(saved.payload, saved.context).all(organizationId)
      .map(client => client.counterpartyGuid.toLowerCase()).filter(guid => GUID.test(guid))
  } catch { return [] }
}
