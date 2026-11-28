import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PrismaClient } from "@prisma/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  bakuNight, HISTORY_DAYS, nextNightStart, REQUEST_GAP_MS, salesReadOpen,
  decodeSalesSoap, parseValueTable, productsOfSale, rankSalesProducts, refreshZeytunSalesHistory, salesFromSettlements,
  popularSalesProducts, salesHistorySource, SalesHistoryStore, ZEYTUN_SALES_CONNECTION_FILE, type SalesFetch,
} from "@/lib/voice-agent/pharmacy/zeytun-sales-history"

// Owner 2026-11-11 («Да, подключай»): what 1C sold a pharmacy, for the line's ear.
// Shapes are 1C's own answers to Get_Sales on 2026-11-11, every value synthetic.

const ORG = "tenant-test"
const PHARMACY = "3ed36d74-0000-11e9-80cb-0894ef5e9ba2"
const A = "05bf4b43-5c22-11e9-80c5-0894ef5e9ba2", B = "15bf4b43-5c22-11e9-80c5-0894ef5e9ba2", C = "25bf4b43-5c22-11e9-80c5-0894ef5e9ba2"
const D = "35bf4b43-5c22-11e9-80c5-0894ef5e9ba2"
// 23:00 in Baku: the job reads 1C only at night.
const NOW = Date.parse("2026-11-11T19:00:00Z")

const column = (name: string) => `<column><Name>${name}</Name><ValueType><Type>xs:string</Type><StringQualifiers><Length>0</Length></StringQualifiers></ValueType><Title>${name}</Title><Width>10</Width></column>`
const table = (columns: string[], rows: string[], nested = false) =>
  `<${nested ? 'Value xsi:type="ValueTable"' : 'ValueTable xmlns="http://v8.1c.ru/8.1/data/core" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'}>${
    columns.map(column).join("")}${rows.map(row => `<row>${row}</row>`).join("")}</${nested ? "Value" : "ValueTable"}>`
const value = (text: string, type = "xs:string") => `<Value xsi:type="${type}">${text}</Value>`
const settlements = (sales: Array<[string, string]>) => table(
  ["Регистратор", "СуммаВзаиморасчетовПриход", "Период", "ДоговорКонтрагента"],
  [
    ...sales.map(([number, period]) => value(`Реализация товаров и услуг ${number} от 1/1/2026 12:00:00 AM`) + value("10.5", "xs:decimal") + value(period, "xs:dateTime") + value("Основной")),
    value("Платежное поручение входящее 000123 от 1/2/2026 9:00:00 AM") + value("10.5", "xs:decimal") + value("2026-11-01T09:00:00", "xs:dateTime") + value("Основной"),
  ])
const sale = (number: string, goods: Array<[string, string]>) => table(
  ["ГУИДДОКУМЕНТА", "Комментарий", "НомерДокумента", "ТаблицаТоваров", "Тип"],
  [value("4a00314c-dd95-11f1-9aa2-000c293cab90") + value(" ") + value(number) +
    table(["ГуидНоменклатуры", "Количество", "Цена", "УсловиеАвтоматическойСкидки", "ЗначениеУсловияАвтоматическойСкидки", "ХарактеристикаНоменклатуры"],
      goods.map(([id, quantity]) => value(id) + value(quantity, "xs:decimal") + value("7.52", "xs:decimal")
        + '<Value xmlns:d5p1="http://v8.1c.ru/8.1/data/enterprise/current-config" xsi:type="d5p1:EnumRef.УсловияСкидкиНаценки"/>'
        + '<Value xsi:nil="true"/>' + value("2029-10-01T00:00:00", "xs:dateTime")), true)
    + value("Реализация")])
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
const soap = (inner: string) => Buffer.from('<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
  + '<m:SalesResponse xmlns:m="GetSales"><m:return xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
  + escape(inner) + "</m:return></m:SalesResponse></soap:Body></soap:Envelope>")

describe("Get_Sales answers", () => {
  it("lists only sales among the settlement documents, newest first, with their day", () => {
    const list = salesFromSettlements(parseValueTable(decodeSalesSoap(soap(settlements([["ZN000000001", "2026-10-01T10:00:00"], ["ZN000000002", "2026-11-10T12:45:37"]])))))
    expect(list).toEqual([{ number: "ZN000000002", date: "2026-11-10" }, { number: "ZN000000001", date: "2026-10-01" }])
  })

  it("reads a sale's products from its nested goods table, skipping zero quantities", () => {
    const parsed = parseValueTable(decodeSalesSoap(soap(sale("ZN000000002", [[A, "2"], [B, "0"], [C.toUpperCase(), "1"]]))))
    expect(productsOfSale(parsed, "ZN000000002")).toEqual([A, C])
    expect(productsOfSale(parsed, "ZN000000003")).toBeNull()
  })

  it("refuses anything but 1C's SalesResponse, and never echoes it", () => {
    expect(() => decodeSalesSoap(Buffer.from("<html>Документ не найден ZN000000002</html>"))).toThrow(/^invalid_response$/)
    expect(() => parseValueTable('<!DOCTYPE x><ValueTable xmlns="http://v8.1c.ru/8.1/data/core"/>')).toThrow(/^invalid_response$/)
    expect(() => parseValueTable('<ValueTable xmlns="urn:other"/>')).toThrow(/^invalid_response$/)
  })
})

describe("a pharmacy's 1C sales history", () => {
  let root: string
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "zeytun-sales-test-")) })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })

  // Owner 2026-11-20: «сделай три месяца».
  it("keeps three months of a pharmacy's sales", () => {
    expect(HISTORY_DAYS).toBe(90)
    const sales = new Map([["1", { date: "2026-08-14", products: [A] }], ["2", { date: "2026-08-12", products: [B] }]])
    expect(rankSalesProducts(sales, NOW)).toEqual([A])
  })

  it("ranks products by how many recent sales held them, ignoring sales older than the window", () => {
    const sales = new Map([
      ["1", { date: "2026-11-10", products: [A, B] }], ["2", { date: "2026-11-01", products: [A] }],
      ["3", { date: "2026-11-05", products: [C] }], ["4", { date: "2025-01-01", products: [C] }],
    ])
    expect(rankSalesProducts(sales, NOW)).toEqual([A, B, C])
  })

  it("stores per pharmacy and gives the line its products, never another pharmacy's", async () => {
    const store = new SalesHistoryStore(root, ORG)
    await store.save(PHARMACY, new Map([["ZN1", { date: "2026-11-10", products: [B, A] }], ["ZN2", { date: "2026-11-09", products: [A] }]]))
    const source = salesHistorySource(root, () => NOW)
    expect(await source.products({ organizationId: ORG, catalogScopeKey: "x", pharmacy: { companyId: null, guid: PHARMACY } })).toEqual([A, B])
    expect(await source.products({ organizationId: "other", catalogScopeKey: "x", pharmacy: { companyId: null, guid: PHARMACY } })).toEqual([])
    expect(await source.products({ organizationId: ORG, catalogScopeKey: "x", pharmacy: { companyId: "c1", guid: null } })).toEqual([])
    expect(await salesHistorySource("", () => NOW).products({ organizationId: ORG, catalogScopeKey: "x", pharmacy: { companyId: null, guid: PHARMACY } })).toEqual([])
  })

  // Owner 2026-11-28: the recognizer's hints came only from the line's own orders, a handful.
  it("counts what pharmacies buy most across every pharmacy the job read, once per pharmacy", async () => {
    const store = new SalesHistoryStore(root, ORG)
    const P2 = "22222222-2222-4222-8222-222222222222", P3 = "33333333-3333-4333-8333-333333333333"
    // A in three pharmacies, B in two (bought many times by one), C in one, D only long ago.
    await store.save(PHARMACY, new Map([["ZN1", { date: "2026-11-10", products: [A, B] }], ["ZN2", { date: "2026-11-09", products: [B] }],
      ["ZN3", { date: "2026-11-08", products: [B] }], ["ZN4", { date: "2025-01-01", products: [D] }]]))
    await store.save(P2, new Map([["ZN5", { date: "2026-11-10", products: [A, C] }]]))
    await store.save(P3, new Map([["ZN6", { date: "2026-11-10", products: [A, B] }]]))
    await store.saveIndex({ [PHARMACY]: { at: NOW, complete: true }, [P2]: { at: NOW, complete: true }, [P3]: { at: NOW, complete: true } })
    expect(await popularSalesProducts(root, ORG, NOW)).toEqual([A, B, C])
    expect(await popularSalesProducts(root, ORG, NOW, 2)).toEqual([A, B])
    // Another organization's files, a relative or empty folder, or nothing read yet: nothing.
    expect(await popularSalesProducts(root, "other", NOW)).toEqual([])
    expect(await popularSalesProducts("", ORG, NOW)).toEqual([])
    expect(await popularSalesProducts("relative/dir", ORG, NOW)).toEqual([])
  })

  describe("the job", () => {
    const instant = async () => {}
    const grantFile = () => join(root, "inbound-grant.json")
    const db = (guids: string[]) => ({ pharmacyPhoneOrder: { findMany: vi.fn(async () => guids.map(pharmacyGuid => ({ pharmacyGuid }))) } }) as unknown as PrismaClient
    const config = { organizationId: ORG, endpoint: "http://1c.example/ztnmain/ws/Get_Sales.1cws", username: "synthetic-user", password: "synthetic-secret", allowPlainHttp: true }
    let listed: Array<[string, string]>
    const download = vi.fn<SalesFetch>(async (_url, options) => {
      const body = String(options.body)
      const code = /<g:CodeSales>([^<]*)</.exec(body)![1]
      if (!code) return { ok: true, status: 200, bodyBytes: soap(settlements(listed)) } as unknown as Awaited<ReturnType<SalesFetch>>
      return { ok: true, status: 200, bodyBytes: soap(sale(code, code.endsWith("1") ? [[A, "1"]] : [[A, "2"], [B, "1"]])) } as unknown as Awaited<ReturnType<SalesFetch>>
    })
    beforeEach(async () => {
      await writeFile(join(root, ZEYTUN_SALES_CONNECTION_FILE), JSON.stringify(config), { mode: 0o600 })
      await chmod(root, 0o700)
      listed = [["ZN000000001", "2026-11-01T10:00:00"], ["ZN000000002", "2026-11-10T10:00:00"], ["ZN000000009", "2025-01-01T10:00:00"]]
      download.mockClear()
    })

    it("does nothing without its connection file", async () => {
      await rm(join(root, ZEYTUN_SALES_CONNECTION_FILE))
      expect(await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY]), env: { grantFile: grantFile(), cacheDir: root }, now: () => NOW, download }))
        .toEqual({ outcome: "not_configured" })
      expect(download).not.toHaveBeenCalled()
    })

    it("reads a caller's recent sales once, then only new ones, and drops a sale 1C no longer lists", async () => {
      const env = { grantFile: grantFile(), cacheDir: root }
      const first = await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY]), env, now: () => NOW, download })
      expect(first).toMatchObject({ outcome: "done", pharmacies: 1, sales: 2, failures: 0 })
      // The list, then the two sales inside the window: the 2025 one is never asked.
      expect(download).toHaveBeenCalledTimes(3)
      expect(download.mock.calls.map(([, options]) => /<g:CodeSales>([^<]*)</.exec(String(options.body))![1])).toEqual(["", "ZN000000002", "ZN000000001"])
      expect(await salesHistorySource(root, () => NOW).products({ organizationId: ORG, catalogScopeKey: "x", pharmacy: { companyId: null, guid: PHARMACY } }))
        .toEqual([A, B])

      // Six hours on: the list again, one new sale, and ZN…1 is gone from 1C.
      listed = [["ZN000000002", "2026-11-10T10:00:00"], ["ZN000000003", "2026-11-11T08:00:00"]]
      download.mockClear()
      const later = NOW + 6 * 3_600_000
      expect(await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY]), env, now: () => later, download })).toMatchObject({ sales: 1 })
      expect(download).toHaveBeenCalledTimes(2)
      const kept = await new SalesHistoryStore(root, ORG).load(PHARMACY)
      expect([...kept!.keys()].sort()).toEqual(["ZN000000002", "ZN000000003"])

      // Not due yet: 1C is not asked at all.
      download.mockClear()
      expect(await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY]), env, now: () => later + 60_000, download })).toMatchObject({ pharmacies: 0, due: 0 })
      expect(download).not.toHaveBeenCalled()
    })

    it("stops at its budget and finishes the pharmacy next tick", async () => {
      const env = { grantFile: grantFile(), cacheDir: root }
      let clock = NOW
      const slow = vi.fn<SalesFetch>(async (url, options) => { clock += 3_000; return download(url, options) })
      expect(await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY]), env, now: () => clock, download: slow, budgetMs: 7_000 }))
        .toMatchObject({ outcome: "done", pharmacies: 1, sales: 1 })
      expect((await new SalesHistoryStore(root, ORG).loadIndex())[PHARMACY]).toMatchObject({ complete: false })
      clock += 60_000
      expect(await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY]), env, now: () => clock, download: slow, budgetMs: 600_000 }))
        .toMatchObject({ sales: 1 })
      expect((await new SalesHistoryStore(root, ORG).loadIndex())[PHARMACY]).toMatchObject({ complete: true })
    })

    it("stops at once when 1C refuses the account, stands down until the next night, keeps no prices or credentials", async () => {
      const env = { grantFile: grantFile(), cacheDir: root }
      await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY]), env, now: () => NOW, download })
      const dir = (await readdir(root)).find(name => name.startsWith("sales-history-"))!
      const { readFile } = await import("node:fs/promises")
      const stored = await readFile(join(root, dir, `${PHARMACY}.json`), "utf8")
      expect(stored).not.toMatch(/7\.52|synthetic|10\.5/)

      const refused = vi.fn<SalesFetch>(async () => ({ ok: false, status: 401, bodyBytes: Buffer.from("") }) as unknown as Awaited<ReturnType<SalesFetch>>)
      expect(await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY, A]), env, now: () => NOW, download: refused }))
        .toMatchObject({ outcome: "failed", error: "authentication_required" })
      expect(refused).toHaveBeenCalledTimes(1)
      expect(await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY, A]), env, now: () => NOW + 3_600_000, download: refused }))
        .toMatchObject({ outcome: "paused", until: new Date(nextNightStart(NOW)).toISOString() })
      expect(refused).toHaveBeenCalledTimes(1)
    })

    // Owner 2026-11-18 «включай», after 2026-11-11: ~4 requests a second dropped Zeytun's integrations with 1C.
    it("reads only at night in Baku", async () => {
      const env = { grantFile: grantFile(), cacheDir: root }
      expect(bakuNight(Date.parse("2026-11-11T17:59:00Z"))).toBe(false) // 21:59 Baku
      expect(bakuNight(Date.parse("2026-11-11T18:00:00Z"))).toBe(true) // 22:00
      expect(bakuNight(Date.parse("2026-11-12T02:59:00Z"))).toBe(true) // 06:59
      expect(bakuNight(Date.parse("2026-11-12T03:00:00Z"))).toBe(false) // 07:00
      expect(new Date(nextNightStart(Date.parse("2026-11-12T03:00:00Z"))).toISOString()).toBe("2026-11-12T18:00:00.000Z")
      expect(await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY]), env, now: () => Date.parse("2026-11-12T08:00:00Z"), download }))
        .toEqual({ outcome: "outside_hours" })
      expect(download).not.toHaveBeenCalled()
      // The night ending mid-tick ends the tick.
      let clock = Date.parse("2026-11-12T02:59:55Z")
      const late = vi.fn<SalesFetch>(async (url, options) => { clock += 1_000; return download(url, options) })
      const run = await refreshZeytunSalesHistory({ sleep: async ms => { clock += ms }, db: db([PHARMACY]), env, now: () => clock, download: late })
      // The list and one sale fit before 07:00; the next request would start after it.
      expect(late).toHaveBeenCalledTimes(2)
      expect(run).toMatchObject({ outcome: "done", sales: 1 })
    })

    // Owner 2026-11-21: «завтра не рабочий день, включи с утра до вечера».
    it("also reads through the daytime of a day the owner named, and only that day", async () => {
      expect(salesReadOpen(Date.parse("2026-11-21T08:00:00Z"))).toBe(false) // Saturday 12:00 Baku
      expect(salesReadOpen(Date.parse("2026-11-22T03:00:00Z"))).toBe(true) // Sunday 07:00
      expect(salesReadOpen(Date.parse("2026-11-22T17:59:00Z"))).toBe(true) // Sunday 21:59
      expect(salesReadOpen(Date.parse("2026-11-23T02:59:00Z"))).toBe(true) // Monday 06:59, still night
      expect(salesReadOpen(Date.parse("2026-11-23T03:00:00Z"))).toBe(false) // Monday 07:00
      expect(salesReadOpen(Date.parse("2026-11-29T08:00:00Z"))).toBe(false) // next Sunday: not named

      const env = { grantFile: grantFile(), cacheDir: root }
      const noon = Date.parse("2026-11-22T08:00:00Z")
      expect(await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY]), env, now: () => noon, download }))
        .toMatchObject({ outcome: "done", sales: 2 })

      // A slow 1C on that day stops the job until 22:00 of the same day.
      let clock = noon + 6 * 3_600_000
      listed = [["ZN000000003", "2026-11-22T10:00:00"]]
      const sluggish = vi.fn<SalesFetch>(async (url, options) => { clock += 9_000; return download(url, options) })
      expect(await refreshZeytunSalesHistory({ sleep: async ms => { clock += ms }, db: db([PHARMACY]), env, now: () => clock, download: sluggish }))
        .toMatchObject({ outcome: "stopped", error: "slow" })
      expect(await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY]), env, now: () => clock + 60_000, download }))
        .toMatchObject({ outcome: "paused", until: "2026-11-22T18:00:00.000Z" })
    })

    it("waits two seconds between requests", async () => {
      const env = { grantFile: grantFile(), cacheDir: root }
      let clock = NOW
      const starts: number[] = []
      const timed = vi.fn<SalesFetch>(async (url, options) => { starts.push(clock); clock += 300; return download(url, options) })
      await refreshZeytunSalesHistory({ sleep: async ms => { clock += ms }, db: db([PHARMACY]), env, now: () => clock, download: timed })
      expect(starts).toHaveLength(3)
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(REQUEST_GAP_MS + 300)
    })

    it("stands down until the next night when 1C answers slowly", async () => {
      const env = { grantFile: grantFile(), cacheDir: root }
      let clock = NOW
      const sluggish = vi.fn<SalesFetch>(async (url, options) => { clock += 9_000; return download(url, options) })
      expect(await refreshZeytunSalesHistory({ sleep: async ms => { clock += ms }, db: db([PHARMACY, A]), env, now: () => clock, download: sluggish }))
        .toMatchObject({ outcome: "stopped", error: "slow" })
      expect(sluggish).toHaveBeenCalledTimes(1)
      const asked = download.mock.calls.length
      expect(await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY, A]), env, now: () => clock + 60_000, download }))
        .toMatchObject({ outcome: "paused" })
      expect(download.mock.calls.length).toBe(asked)
      // The next night it reads again.
      const next = nextNightStart(clock) + 60_000
      expect(await refreshZeytunSalesHistory({ sleep: instant, db: db([PHARMACY]), env, now: () => next, download }))
        .toMatchObject({ outcome: "done" })
    })
  })
})
