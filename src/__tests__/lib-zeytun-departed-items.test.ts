/**
 * A product sold out lately is still known by name (live call cac2adb9,
 * 2026-11-04: Adefa ran out by noon and the line said "not found").
 */
import { createHash } from "node:crypto"
import { mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ZeytunAvailableBalances } from "@/lib/voice-agent/pharmacy/zeytun-available-balances"
import { ZeytunBalanceCache } from "@/lib/voice-agent/pharmacy/zeytun-balance-cache"
import { zeytunBalanceScopeKey } from "@/lib/voice-agent/pharmacy/zeytun-balance-client"
import { createDepartedSearch, DEPARTED_KEPT_MS, nextDeparted, type DepartedItem } from "@/lib/voice-agent/pharmacy/zeytun-departed-items"
import { createInboundPilotHandler, type InboundPilotCatalog } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { ZeytunSnapshotStore } from "@/lib/voice-agent/pharmacy/zeytun-snapshot-store"
import { payload, row, secondGuid } from "./fixtures/zeytun-balances"

const ADEFA = "aaaaaaaa-0001-4111-8111-111111111111", ADEMTA = "aaaaaaaa-0002-4111-8111-111111111111"
const ADENURIC = "aaaaaaaa-0003-4111-8111-111111111111"
function product(id: string, name: string, nameAz: string, quantity: number) {
  const base = row()
  return { ...base, Количество: quantity, Номенклатура: { ...base.Номенклатура, Guid: id, Номер: `N-${id.slice(9, 13)}`, Наименование: name, НаименованиеАз: nameAz } }
}
const adefa = product(ADEFA, "Адефа № 30 (Таблетки) (Pharmex Rom Industry Srl) (Румыния)", "", 7)
const ademta = product(ADEMTA, "Адемта 400 мг № 20 (Таблетки) (VÖRLD MEDİSİN) (Турция)", "Ademta 400 mq № 20 (Həb) (WorldMedicine) (Türkiyə)", 40)
const adenuric = product(ADENURIC, "Аденурик 80 мг № 28 (Таблетки) (Berlin-Chemie) (Германия)", "Adenuric 80 mq № 28 (Həb) (Berlin-Chemie) (Almaniya)", 12)

const gone = (id: string, goneAt: string): DepartedItem => ({ externalId: id, itemCode: "N-1", name: `Name ${id.slice(9, 13)}`, nameAz: null,
  baseUnitAsReported: "шт", goneAt })

describe("the list of sold-out products", () => {
  it("keeps what the old snapshot had and the new one lacks, from when it was first missed, and drops what is back or too old", () => {
    const at = Date.parse("2026-11-04T12:00:00Z")
    const label = (id: string) => ({ externalId: id, itemCode: "N", name: id, nameAz: null, baseUnitAsReported: "шт" })
    const ID = (n: number) => `aaaaaaaa-00${String(n).padStart(2, "0")}-4111-8111-111111111111`
    const list = nextDeparted({
      previous: [gone(ID(1), "2026-11-03T12:00:00Z"), gone(ID(2), "2026-11-03T12:00:00Z"), gone(ID(3), new Date(at - DEPARTED_KEPT_MS).toISOString())],
      before: [label(ID(1)), label(ID(4)), label(ID(5))],
      now: [{ externalId: ID(2) }, { externalId: ID(5) }],
      at,
    })
    // 1 still gone since yesterday, 2 back in stock, 3 fourteen days old, 4 gone now, 5 still there.
    expect(list.map((item) => [item.externalId, item.goneAt])).toEqual([
      [ID(4), "2026-11-04T12:00:00.000Z"], [ID(1), "2026-11-03T12:00:00Z"]])
  })

  it("finds a sold-out product only when the caller's word is its name, also from the Latin of a Cyrillic name", () => {
    const search = createDepartedSearch([
      { externalId: ADEFA, itemCode: "N-1", name: "Адефа № 30 (Таблетки) (Pharmex Rom Industry Srl) (Румыния)", nameAz: null, baseUnitAsReported: "шт", goneAt: "2026-11-04T12:00:00Z" },
      { externalId: ADEMTA, itemCode: "N-2", name: "Адемта 400 мг № 5 (Ампулы) (<>) (Турция)", nameAz: null, baseUnitAsReported: "шт", goneAt: "2026-11-04T12:00:00Z" },
    ])
    expect(search.find("Adefa").map((item) => item.externalId)).toEqual([ADEFA])
    expect(search.find("Adefa beş qutu").map((item) => item.externalId)).toEqual([ADEFA])
    expect(search.find("Adexa").map((item) => item.externalId)).toEqual([ADEFA])
    // Another product that sounds near is not this one, and a maker's word is no product's name.
    expect(search.find("Adenuric")).toEqual([])
    expect(search.find("Pharmex")).toEqual([])
    expect(search.find("Ade")).toEqual([])
  })
})

describe("the catalog refresh remembers what sold out", () => {
  const config = {
    organizationId: "tenant-test", endpoint: "https://inventory.example/AvailableBalances",
    username: "test-account", password: "test-secret-never-store",
    request: { GUID: ADEFA, METRO: false, Warehouse: secondGuid },
  }
  const scopeKey = zeytunBalanceScopeKey(config)
  let root: string
  let now: number
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "zeytun-departed-test-")); now = Date.parse("2026-11-04T00:00:00Z") })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })
  const feedOf = (rows: unknown[]) => {
    const bytes = Buffer.from(payload(rows))
    return { payload: bytes, scopeKey, feed: new ZeytunAvailableBalances(bytes, { organizationId: config.organizationId, observedAt: new Date(now).toISOString(), source: "live" }) }
  }

  it("writes the list when a snapshot replaces another, privately, and the next refresh keeps it", async () => {
    const store = new ZeytunSnapshotStore(root, config.organizationId, scopeKey)
    const fetchFeed = vi.fn(async () => feedOf([adefa, ademta, adenuric]))
    const cache = () => new ZeytunBalanceCache(config, store, fetchFeed as never, () => now)
    expect((await cache().refresh()).outcome).toBe("updated")
    expect(await store.loadDeparted()).toEqual([])

    // By noon Adefa is sold out: 1C's feed no longer lists it.
    now = Date.parse("2026-11-04T12:00:00Z")
    fetchFeed.mockImplementation(async () => feedOf([ademta, adenuric]))
    expect((await cache().refresh()).outcome).toBe("updated")
    expect(await store.loadDeparted()).toEqual([{ externalId: ADEFA, itemCode: adefa.Номенклатура.Номер, name: adefa.Номенклатура.Наименование,
      nameAz: null, baseUnitAsReported: "шт", goneAt: "2026-11-04T12:00:00.000Z" }])
    expect((await stat(join(root, `${scopeKey}.departed`))).mode & 0o777).toBe(0o600)

    // The same stock re-observed changes nothing; Adefa back in stock leaves the list.
    now += 61 * 60_000
    expect((await cache().refresh()).outcome).toBe("updated")
    expect((await store.loadDeparted()).map((item) => item.externalId)).toEqual([ADEFA])
    now += 61 * 60_000
    fetchFeed.mockImplementation(async () => feedOf([adefa, ademta, adenuric]))
    expect((await cache().refresh()).outcome).toBe("updated")
    expect(await store.loadDeparted()).toEqual([])
    expect((await readdir(root)).sort()).toEqual([`${scopeKey}.arrived`, `${scopeKey}.attempt`, `${scopeKey}.departed`, `${scopeKey}.snapshot`, "refresh.lock"])
  })

  it("an unreadable list is no list: the refresh still replaces the snapshot", async () => {
    const store = new ZeytunSnapshotStore(root, config.organizationId, scopeKey)
    await store.saveDeparted([])
    const { writeFile } = await import("node:fs/promises")
    await writeFile(join(root, `${scopeKey}.departed`), "{not json")
    const fetchFeed = vi.fn(async () => feedOf([adefa, ademta]))
    expect((await new ZeytunBalanceCache(config, store, fetchFeed as never, () => now).refresh()).outcome).toBe("updated")
    now += 61 * 60_000
    fetchFeed.mockImplementation(async () => feedOf([ademta]))
    expect((await new ZeytunBalanceCache(config, store, fetchFeed as never, () => now).refresh()).outcome).toBe("updated")
    expect((await store.loadDeparted()).map((item) => item.externalId)).toEqual([ADEFA])
  })
})

// ---- The line's search ----

const at = Date.parse("2026-11-04T13:19:00Z"), token = "t".repeat(48)
const callId = "bbbbbbbb-1111-4111-8111-111111111111"
const line = {
  version: 1, enabled: true, purpose: "zeytun_line", id: "dddddddd-1111-4111-8111-111111111111",
  organizationId: "tenant-test", channelConfigId: "line-test",
  issuedAt: new Date(at - 60_000).toISOString(), approvalReference: "owner",
  approvedSource: { organizationId: "inspection-test", scopeKey: "a".repeat(64) }, orderOrganizationId: "org-zeytun",
}
const call = {
  id: "call-test", organizationId: line.organizationId, channelConfigId: line.channelConfigId, providerCallId: callId,
  provider: "asterisk", direction: "inbound", callMode: "ai", status: "in-progress", wasAnswered: true, endedAt: null,
  startedAt: new Date(at).toISOString(), fromNumber: "+994552223344", targetPhoneE164: "+994552223344",
}

async function lineSearch(text: string, options: { rows?: unknown[]; departed?: DepartedItem[]; purpose?: string } = {}) {
  const bytes = Buffer.from(payload(options.rows ?? [ademta, adenuric]))
  const feed = new ZeytunAvailableBalances(bytes, { organizationId: line.approvedSource.organizationId, observedAt: new Date(at).toISOString(), source: "live" })
  const catalog: InboundPilotCatalog = {
    organizationId: line.approvedSource.organizationId, scopeKey: line.approvedSource.scopeKey,
    version: createHash("sha256").update(bytes).digest("hex"), observedAt: new Date(at).toISOString(), source: "live",
    search: (query) => feed.search(line.approvedSource.organizationId, query),
    departed: createDepartedSearch(options.departed ?? [{ externalId: ADEFA, itemCode: adefa.Номенклатура.Номер, name: adefa.Номенклатура.Наименование,
      nameAz: null, baseUnitAsReported: "шт ", goneAt: "2026-11-04T12:00:00Z" }]),
  }
  const handle = createInboundPilotHandler(token, {
    loadConfig: async () => ({ ...structuredClone(line), ...(options.purpose ? { purpose: options.purpose } : {}) }),
    loadCall: async () => structuredClone(call), loadCatalog: async () => catalog,
    claim: async () => true, isClaimed: async () => true, clock: () => at,
  })
  const response = await handle(new Request("https://crm.example.test/internal", { method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "search", callId, query: { text } }) }))
  return { status: response.status, body: await response.json() as { status: string; candidates: Record<string, unknown>[]; needsNarrowing: boolean } }
}

describe("the line's search offers a sold-out product by its name", () => {
  afterEach(() => vi.restoreAllMocks())

  it("adds Adefa after the five with stock 0 and no price, so the agent can say it ran out", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const { status, body } = await lineSearch("Adefa")
    expect(status).toBe(200)
    expect(body.candidates.map((item) => item.externalId)).toEqual([ADEMTA, ADENURIC, ADEFA])
    const soldOut = body.candidates[2]
    expect(soldOut).toEqual({ externalId: ADEFA, itemCode: adefa.Номенклатура.Номер, name: adefa.Номенклатура.Наименование, nameAz: null,
      identityVerified: false, stock: { quantity: 0, per: "qutu" } })
    expect(body.candidates[0]).toHaveProperty("listPrice")
    expect(log.mock.calls.map((args) => args.join(" ")).join("\n")).toContain('[zeytun-line] sold out {"call":"bbbbbbbb-1111-4111-8111-111111111111","found":1}')
  })

  it("answers candidates for a product the catalog lacks entirely but sold lately", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    const { body } = await lineSearch("Adefa", { rows: [adenuric] })
    expect(body.candidates.map((item) => item.externalId)).toEqual([ADENURIC, ADEFA])
    const { body: only } = await lineSearch("Adefa beş qutu", { rows: [product("aaaaaaaa-0009-4111-8111-111111111111", "Парацетамол 500 мг № 20", "Parasetamol 500 mq № 20", 5)] })
    expect(only.status).toBe("candidates_only")
    expect(only.candidates.map((item) => item.externalId)).toEqual([ADEFA])
  })

  it("never offers as sold out a product the catalog has, nor one under another name", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    const inStock = await lineSearch("Adefa", { rows: [adefa, ademta, adenuric] })
    expect(inStock.body.candidates.filter((item) => item.externalId === ADEFA)).toEqual([expect.objectContaining({ stock: { quantity: 7, per: "qutu" } })])
    expect((await lineSearch("Adenuric")).body.candidates.map((item) => item.externalId)).not.toContain(ADEFA)
    expect((await lineSearch("substitute: BISACODYL; 5 mg")).body.candidates.map((item) => item.externalId)).not.toContain(ADEFA)
  })

  it("is the line's only: the owner's rehearsal searches as before", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    const preview = await lineSearch("Adefa", { purpose: "owner_inbound_preview" })
    expect(preview.body.candidates?.map((item) => item.externalId) ?? []).not.toContain(ADEFA)
  })
})
