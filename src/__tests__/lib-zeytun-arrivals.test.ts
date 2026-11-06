/**
 * Owner's client, 2026-11-06: a sold-out product the pharmacy still wants
 * goes on a waiting list, and its next call hears what came back of what it
 * waited for or orders («есть новые поступления, хотите ли узнать?»; owner
 * chose «А» — only this pharmacy's products).
 */
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ARRIVAL_HOLD_COUNT, ARRIVAL_MIN_ABSENCE_MS, ARRIVED_KEPT_MS, nextArrived } from "@/lib/voice-agent/pharmacy/zeytun-arrived-items"
import { ZeytunAvailableBalances } from "@/lib/voice-agent/pharmacy/zeytun-available-balances"
import { ZeytunBalanceCache } from "@/lib/voice-agent/pharmacy/zeytun-balance-cache"
import { zeytunBalanceScopeKey } from "@/lib/voice-agent/pharmacy/zeytun-balance-client"
import { createDepartedSearch } from "@/lib/voice-agent/pharmacy/zeytun-departed-items"
import { arrivalsNote, createInboundPilotHandler, LINE_PROMPT_MAX_CHARS, ZEYTUN_LINE_PROMPT,
  type InboundPilotCatalog } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { ZeytunSnapshotStore } from "@/lib/voice-agent/pharmacy/zeytun-snapshot-store"
import { payload, row, secondGuid } from "./fixtures/zeytun-balances"

const ID = (n: number) => `aaaaaaaa-00${String(n).padStart(2, "0")}-4111-8111-111111111111`
const ADEFA = ID(1), ADEMTA = ID(2), ADENURIC = ID(3)
function product(id: string, name: string, nameAz: string, quantity: number) {
  const base = row()
  return { ...base, Количество: quantity, Номенклатура: { ...base.Номенклатура, Guid: id, Номер: `N-${id.slice(9, 13)}`, Наименование: name, НаименованиеАз: nameAz } }
}
const adefa = product(ADEFA, "Адефа № 30 (Таблетки) (Pharmex Rom Industry Srl) (Румыния)", "", 7)
const ademta = product(ADEMTA, "Адемта 400 мг № 20 (Таблетки) (VÖRLD MEDİSİN) (Турция)", "Ademta 400 mq № 20 (Həb) (WorldMedicine) (Türkiyə)", 40)
const adenuric = product(ADENURIC, "Аденурик 80 мг № 28 (Таблетки) (Berlin-Chemie) (Германия)", "Adenuric 80 mq № 28 (Həb) (Berlin-Chemie) (Almaniya)", 12)

describe("the list of arrivals", () => {
  const at = Date.parse("2026-11-06T12:00:00Z")
  const ids = (...n: number[]) => n.map(i => ({ externalId: ID(i) }))

  it("records what the new snapshot has and the old one lacked, with when it went, and drops what is gone again or too old", () => {
    const { items, held } = nextArrived({
      previous: [
        { externalId: ID(5), arrivedAt: "2026-11-05T12:00:00Z", goneAt: null },
        { externalId: ID(6), arrivedAt: "2026-11-05T12:00:00Z", goneAt: null },
        { externalId: ID(7), arrivedAt: new Date(at - ARRIVED_KEPT_MS).toISOString(), goneAt: null },
      ],
      departed: [{ externalId: ID(1), goneAt: "2026-11-05T09:00:00Z" }],
      before: ids(2, 5, 6, 7),
      now: ids(1, 2, 3, 5, 7),
      at,
    })
    expect(held).toBe(false)
    // 1 back after a day, 3 never seen before; 5 still in stock; 6 gone again; 7 fourteen days old.
    expect(items).toEqual([
      { externalId: ID(1), arrivedAt: "2026-11-06T12:00:00.000Z", goneAt: "2026-11-05T09:00:00Z" },
      { externalId: ID(3), arrivedAt: "2026-11-06T12:00:00.000Z", goneAt: null },
      { externalId: ID(5), arrivedAt: "2026-11-05T12:00:00Z", goneAt: null },
    ])
  })

  it("keeps the day a product first came back, also when a refresh misses it in between", () => {
    const { items } = nextArrived({ previous: [{ externalId: ID(1), arrivedAt: "2026-11-05T12:00:00Z", goneAt: null }], departed: [],
      before: [], now: ids(1), at })
    expect(items).toEqual([{ externalId: ID(1), arrivedAt: "2026-11-05T12:00:00Z", goneAt: null }])
  })

  it("is no news when a refresh only missed it for a while", () => {
    const { items } = nextArrived({ previous: [], departed: [{ externalId: ID(1), goneAt: new Date(at - ARRIVAL_MIN_ABSENCE_MS + 60_000).toISOString() }],
      before: [], now: ids(1), at })
    expect(items).toEqual([])
  })

  it("records nothing when a large share of the catalog comes back at once: that was a cut-off answer before", () => {
    const now = Array.from({ length: ARRIVAL_HOLD_COUNT * 2 }, (_, i) => ({ externalId: `aaaaaaaa-${String(i).padStart(4, "0")}-4111-8111-111111111111` }))
    const { items, held } = nextArrived({ previous: [], departed: [], before: now.slice(0, 10), now, at })
    expect(held).toBe(true)
    expect(items).toEqual([])
  })
})

describe("the catalog refresh remembers what came back", () => {
  const config = {
    organizationId: "tenant-test", endpoint: "https://inventory.example/AvailableBalances",
    username: "test-account", password: "test-secret-never-store",
    request: { GUID: ADEFA, METRO: false, Warehouse: secondGuid },
  }
  const scopeKey = zeytunBalanceScopeKey(config)
  let root: string, now: number
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "zeytun-arrived-test-")); now = Date.parse("2026-11-04T00:00:00Z") })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })
  const feedOf = (rows: unknown[]) => {
    const bytes = Buffer.from(payload(rows))
    return { payload: bytes, scopeKey, feed: new ZeytunAvailableBalances(bytes, { organizationId: config.organizationId, observedAt: new Date(now).toISOString(), source: "live" }) }
  }

  it("writes Adefa as arrived when 1C lists it again hours after it sold out", async () => {
    const store = new ZeytunSnapshotStore(root, config.organizationId, scopeKey)
    const fetchFeed = vi.fn(async () => feedOf([adefa, ademta]))
    const cache = () => new ZeytunBalanceCache(config, store, fetchFeed as never, () => now)
    expect((await cache().refresh()).outcome).toBe("updated")
    now = Date.parse("2026-11-04T12:00:00Z")
    fetchFeed.mockImplementation(async () => feedOf([ademta]))
    expect((await cache().refresh()).outcome).toBe("updated")
    expect(await store.loadArrived()).toEqual([])
    now = Date.parse("2026-11-05T08:00:00Z")
    fetchFeed.mockImplementation(async () => feedOf([adefa, ademta]))
    expect((await cache().refresh()).outcome).toBe("updated")
    expect(await store.loadArrived()).toEqual([{ externalId: ADEFA, arrivedAt: "2026-11-05T08:00:00.000Z", goneAt: "2026-11-04T12:00:00.000Z" }])
    // And the sold-out list let it go.
    expect(await store.loadDeparted()).toEqual([])
  })
})

// ---- The line's session and save ----

const at = Date.parse("2026-11-06T09:00:00Z"), token = "t".repeat(48)
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
const NARIMANOV = { guid: "eeeeeeee-1111-4111-8111-111111111111", name: "Nərimanov aptek", address: null }

function lineHandler(options: { pharmacies?: typeof NARIMANOV[]; arrivals?: () => Promise<{ externalId: string; name: string; waited: boolean }[]>;
  purpose?: string } = {}) {
  const bytes = Buffer.from(payload([ademta, adenuric]))
  const feed = new ZeytunAvailableBalances(bytes, { organizationId: line.approvedSource.organizationId, observedAt: new Date(at).toISOString(), source: "live" })
  const catalog: InboundPilotCatalog = {
    organizationId: line.approvedSource.organizationId, scopeKey: line.approvedSource.scopeKey,
    version: createHash("sha256").update(bytes).digest("hex"), observedAt: new Date(at).toISOString(), source: "live",
    search: (query) => feed.search(line.approvedSource.organizationId, query),
    departed: createDepartedSearch([{ externalId: ADEFA, itemCode: adefa.Номенклатура.Номер, name: adefa.Номенклатура.Наименование,
      nameAz: null, baseUnitAsReported: "шт ", goneAt: "2026-11-04T12:00:00Z" }]),
  }
  const saveOrder = vi.fn(async () => ({ status: "saved" as const, orderId: "o1", number: 1040, revision: 1, created: true, changed: true,
    total: "0.00", currency: "AZN" as const, priced: 0, unpriced: [], notFound: [] }))
  const pharmacyArrivals = vi.fn(options.arrivals ?? (async () => []))
  const handle = createInboundPilotHandler(token, {
    loadConfig: async () => ({ ...structuredClone(line), ...(options.purpose ? { purpose: options.purpose, testPhoneE164: call.fromNumber,
      expiresAt: new Date(at + 600_000).toISOString(), approvedSource: { ...line.approvedSource, catalogVersion: catalog.version } } : {}) }),
    loadCall: async () => structuredClone(call), loadCatalog: async () => catalog,
    claim: async () => true, isClaimed: async () => true, clock: () => at,
    findPharmacies: async () => options.pharmacies ?? [NARIMANOV], saveOrder, pharmacyArrivals,
  })
  const post = async (body: unknown) => {
    const response = await handle(new Request("https://crm.example.test/internal", { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }
  return { post, saveOrder, pharmacyArrivals }
}

describe("the call's news: what this pharmacy waited for or orders, back in stock", () => {
  afterEach(() => vi.restoreAllMocks())

  it("adds the pharmacy's arrivals after the rules, asked once after the caller confirms the pharmacy", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    const f = lineHandler({ arrivals: async () => [{ externalId: ADEFA, name: "Adefa № 30", waited: true },
      { externalId: ADEMTA, name: "Ademta 400 mq № 20", waited: false }] })
    const { body } = await f.post({ action: "session", callId })
    const prompt = body.prompt as string
    expect(prompt.startsWith(ZEYTUN_LINE_PROMPT.slice(0, 200))).toBe(true)
    expect(prompt.endsWith("- Adefa № 30 (waited)\n- Ademta 400 mq № 20\n</pharmacy_arrivals>")).toBe(true)
    expect(prompt).toContain("\"Yeni daxilolmalar var, eşitmək istəyirsiniz?\"")
    expect(prompt).toContain("never if they name another one")
    expect(prompt.length).toBeLessThanOrEqual(LINE_PROMPT_MAX_CHARS)
    expect(f.pharmacyArrivals).toHaveBeenCalledWith(expect.objectContaining({ purpose: "zeytun_line" }), expect.objectContaining({ providerCallId: callId }),
      expect.anything(), NARIMANOV.guid)
  })

  it("asks nothing for a number 1C shares between pharmacies, or when there is no news", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    const shared = lineHandler({ pharmacies: [NARIMANOV, { ...NARIMANOV, guid: "eeeeeeee-2222-4111-8111-111111111111", name: "Zəfər aptek" }],
      arrivals: async () => [{ externalId: ADEFA, name: "Adefa", waited: true }] })
    expect((await shared.post({ action: "session", callId })).body.prompt).not.toContain("pharmacy_arrivals")
    expect(shared.pharmacyArrivals).not.toHaveBeenCalled()
    const none = lineHandler()
    expect((await none.post({ action: "session", callId })).body.prompt).not.toContain("pharmacy_arrivals")
  })

  it("never holds the call up: a slow or failing read leaves the prompt as it was", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined)
    const slow = lineHandler({ arrivals: () => new Promise(() => undefined) })
    const started = Date.now()
    const { status, body } = await slow.post({ action: "session", callId })
    expect(status).toBe(200)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(body.prompt).not.toContain("pharmacy_arrivals")
    const failing = lineHandler({ arrivals: async () => { throw new Error("db") } })
    expect((await failing.post({ action: "session", callId })).body.enabled).toBe(true)
  })

  it("keeps the note inside the station's prompt limit", () => {
    const offers = Array.from({ length: 3 }, (_, i) => ({ externalId: ID(i), name: "X".repeat(200), waited: i === 0 }))
    expect(ZEYTUN_LINE_PROMPT.length + arrivalsNote(offers).length).toBeLessThanOrEqual(LINE_PROMPT_MAX_CHARS)
  })
})

describe("a sold-out product the pharmacy still wants goes on the waiting list", () => {
  it("tells the agent to say it is noted and to write it", () => {
    expect(ZEYTUN_LINE_PROMPT).toContain("if they still want it rather than a substitute, say \"qeyd etdim, gələn kimi xəbər verəcəyik\" and write it with its quantity.")
  })

  it("passes the sold-out line with its 1C id to the save, and only that one", async () => {
    const f = lineHandler()
    const lines = [{ externalId: ADEFA, quantity: 5, unit: "Qutu", spoken: "Adefa beş qutu" },
      { externalId: ADEMTA, quantity: 2, unit: "qutu", spoken: "Ademta iki qutu" },
      { quantity: 1, unit: "qutu", spoken: "Nə isə" }]
    expect((await f.post({ action: "order", callId, lines })).body.status).toBe("saved")
    const delivery = (f.saveOrder.mock.calls[0] as unknown[])[5] as { waiting?: unknown[] }
    expect(delivery.waiting).toEqual([{ externalId: ADEFA, itemCode: adefa.Номенклатура.Номер, productName: adefa.Номенклатура.Наименование,
      spokenText: "Adefa beş qutu", quantity: 5, unit: "qutu" }])
    // The order itself still gets every line, as before.
    expect((f.saveOrder.mock.calls[0] as unknown[])[3]).toEqual(lines)
  })

  it("sends an empty list when nothing is sold out, so a product the caller took back leaves it", async () => {
    const f = lineHandler()
    await f.post({ action: "order", callId, lines: [{ externalId: ADEMTA, quantity: 2, unit: "qutu", spoken: "Ademta" }] })
    expect(((f.saveOrder.mock.calls[0] as unknown[])[5] as { waiting?: unknown[] }).waiting).toEqual([])
  })
})
