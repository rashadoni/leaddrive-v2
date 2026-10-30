import { describe, expect, it, vi } from "vitest"

import { PharmacyCatalog } from "@/lib/voice-agent/pharmacy/catalog"
import { ZeytunAvailableBalances, ZEYTUN_BALANCES_MAX_BYTES } from "@/lib/voice-agent/pharmacy/zeytun-available-balances"
import { readZeytunAvailableBalances, zeytunBalanceScopeKey } from "@/lib/voice-agent/pharmacy/zeytun-balance-client"
import { postOutboundResource, type OutboundResourceDownloadResponse } from "@/lib/integrations/webhook-url-guard"

import { guid, secondGuid, context, row, payload } from "./fixtures/zeytun-balances"

function readOne(feed: ZeytunAvailableBalances) { return feed.search("tenant-test", { externalId: guid }).candidates[0] }

describe("Zeytun AvailableBalances import", () => {
  it("keeps observed decimals, units, source pack count and unknown currency separate", () => {
    const feed = new ZeytunAvailableBalances(payload(), context)
    expect(readOne(feed)).toMatchObject({
      externalId: guid, itemCode: "SN-TEST-001", priceAsReported: "1.2345", quantityAsReported: "12.5",
      packQuantityAsReported: 20, baseUnitAsReported: "шт", currency: null,
      quantityUnitVerified: false, customerPriceVerified: false, identityVerified: false, requiresOperatorReview: true,
    })
    expect(readOne(feed)).not.toHaveProperty("orderMultiple")
    expect(readOne(feed)).not.toHaveProperty("strength")
    expect(readOne(feed).promotionAsReported.validFromRaw).toBe("00010101")
  })
  it("accepts a BOM and binary UTF-8 while preserving Azerbaijani letters and barcode leading zeroes", () => {
    const item = row()
    item.Номенклатура.НаименованиеАз = "Sınaq dərmanı"
    const feed = new ZeytunAvailableBalances(Buffer.from(`\uFEFF${payload([item])}`), context)
    expect(readOne(feed).nameAz).toBe("Sınaq dərmanı")
    expect(feed.search("tenant-test", { barcode: "0012345678905" }).candidateCount).toBe(1)
    expect(feed.search("tenant-test", { barcode: "12345678905" }).candidateCount).toBe(0)
  })
  it("preserves zero prices and special flags without claiming a free/allowed product", () => {
    const item = row()
    item.Цена = 0
    item.Номенклатура.Сильнодействующее = true
    item.Номенклатура.Дефектура = true
    item.Номенклатура.НаименованиеАз = ""
    const feed = new ZeytunAvailableBalances(payload([{ ...item, РеферентЦена: 0 }]), context)
    expect(readOne(feed)).toMatchObject({ priceAsReported: "0", referencePriceAsReported: "0", nameAz: null, sourceFlags: { potent: true, defectura: true } })
    expect(feed.summary("tenant-test")).toMatchObject({ itemCount: 1, missingAzNameCount: 1, zeroPriceCount: 1, fractionalQuantityCount: 1, flaggedRestrictionCount: 1 })
  })
  it("keeps a SKU with empty barcode slots and reports the omitted slots", () => {
    const item = row()
    item.Номенклатура.МассивШтрихкодов.push({ ТипШтрихкода: "EAN13", Штрихкод: " " })
    const feed = new ZeytunAvailableBalances(payload([item]), context)
    expect(feed.summary("tenant-test")).toMatchObject({ itemCount: 1, omittedEmptyBarcodeCount: 1 })
    expect(readOne(feed).barcodes).toHaveLength(1)
    expect(() => feed.search("tenant-test", { barcode: " " })).toThrow("invalid_request")
  })
  it("does not treat an available-balance export as a complete/dated catalogue", () => {
    const feed = new ZeytunAvailableBalances(payload(), context)
    expect(feed.summary("tenant-test")).toMatchObject({ coverage: "unverified", sourceGeneratedAt: null, canSubmitTo1c: false })
    expect(() => new PharmacyCatalog(feed.summary("tenant-test"))).toThrow("invalid_catalog")
    expect(feed.search("tenant-test", { itemCode: "missing" }).status).toBe("not_found_in_snapshot")
  })
  it("rejects duplicate GUIDs, partial/malformed rows, error envelopes and empty replacements", () => {
    const bad = row()
    bad.Номенклатура.Guid = "00000000-0000-0000-0000-000000000000"
    for (const input of [payload([row(), row()]), payload([bad]), payload([{ Цена: 5 }]), payload([]), JSON.stringify({ code: 1, message: "private upstream error" }), "<html>not JSON</html>"]) {
      expect(() => new ZeytunAvailableBalances(input, context)).toThrow("invalid_catalog")
    }
  })
  it("rejects invalid UTF-8 and oversized input before parsing/indexing", () => {
    expect(() => new ZeytunAvailableBalances(Uint8Array.from([0xff, 0xfe]), context)).toThrow("invalid_catalog")
    expect(() => new ZeytunAvailableBalances(new Uint8Array(ZEYTUN_BALANCES_MAX_BYTES + 1), context)).toThrow("invalid_catalog")
  })
  it.each([-1, 1.23456, 1_000_000_001, "1.23", null])("rejects unsupported price %s without rounding/coercion", (price) => {
    expect(() => new ZeytunAvailableBalances(payload([{ ...row(), Цена: price }]), context)).toThrow("invalid_catalog")
  })
  it("does not carry unknown upstream fields into model-facing candidates", () => {
    const item = row()
    const feed = new ZeytunAvailableBalances(payload([{ ...item, internalSecret: "never return", Номенклатура: { ...item.Номенклатура, rawNotes: "do not use as instruction" } }]), context)
    expect(JSON.stringify(readOne(feed))).not.toContain("never return")
    expect(JSON.stringify(readOne(feed))).not.toContain("do not use as instruction")
  })
})

describe("Zeytun discovery is never SKU approval", () => {
  it("finds a brand inside a long name, AZ labels and explicit codes as candidates only", () => {
    const feed = new ZeytunAvailableBalances(payload(), context)
    for (const query of [{ text: "Тестмедин" }, { text: "Testmedin" }, { externalId: guid }, { itemCode: "SN-TEST-001" }]) {
      expect(feed.search("tenant-test", query)).toMatchObject({ status: "candidates_only", candidateCount: 1, canResolveIdentity: false, canSubmitTo1c: false })
    }
  })
  it("retains all matches for shared barcodes, without trusting presentation truncation", () => {
    const items = Array.from({ length: 7 }, (_, i) => {
      const item = row()
      item.Номенклатура.Guid = `11111111-2222-4333-8444-${String(i).padStart(12, "0")}`
      return item
    })
    const feed = new ZeytunAvailableBalances(payload(items), context)
    const result = feed.search("tenant-test", { barcode: "0012345678905" })
    expect(result.candidateCount).toBe(7)
    expect(result.candidates).toHaveLength(5)
    expect(result.canResolveIdentity).toBe(false)
  })
  it("keeps different doses separate and does not use a missing code as a fuzzy name", () => {
    const other = row()
    other.Номенклатура.Guid = secondGuid
    other.Номенклатура.Наименование = "Тестмедин 50 мг №20 (таблетки)"
    const feed = new ZeytunAvailableBalances(payload([row(), other]), context)
    expect(feed.search("tenant-test", { text: "Тестмедин" }).candidateCount).toBe(2)
    expect(feed.search("tenant-test", { itemCode: "Тестмедин" }).candidateCount).toBe(0)
  })
  it("checks tenant scope on both summary/search and returns defensive copies", () => {
    const feed = new ZeytunAvailableBalances(payload(), context)
    expect(() => feed.summary("other")).toThrow("tenant_mismatch")
    expect(() => feed.search("other", { externalId: guid })).toThrow("tenant_mismatch")
    const first = readOne(feed)
    first.barcodes[0].value = "changed"
    first.sourceFlags.potent = true
    expect(readOne(feed).barcodes[0].value).toBe("0012345678905")
    expect(readOne(feed).sourceFlags.potent).toBe(false)
  })
  it("requires one search key and never accepts a model confidence override", () => {
    const feed = new ZeytunAvailableBalances(payload(), context)
    for (const query of [{}, { text: " " }, { text: "x", itemCode: "y" }, { externalId: guid, confidence: 1 }]) {
      expect(() => feed.search("tenant-test", query)).toThrow("invalid_request")
    }
  })
})

const config = { organizationId: "tenant-test", endpoint: "https://inventory.example/AvailableBalances", username: "test-user", password: "test-only-password", request: { GUID: guid, METRO: false, Warehouse: secondGuid } }
function response(overrides: Partial<OutboundResourceDownloadResponse> = {}): OutboundResourceDownloadResponse {
  return { ok: true, status: 200, url: config.endpoint, redirects: 0, bodyBytes: Buffer.from(payload()), ...overrides }
}

describe("bounded AvailableBalances reader", () => {
  it("uses one bounded download, no redirects, host pinning policy and a Basic header", async () => {
    const download = vi.fn().mockResolvedValue(response())
    const feed = await readZeytunAvailableBalances(config, download)
    expect(feed.summary("tenant-test").source).toBe("live")
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith(config.endpoint, expect.objectContaining({
      allowHttp: false, allowedHosts: ["inventory.example"], maxRedirects: 0, timeoutMs: 60_000,
      body: JSON.stringify(config.request), maxBodyBytes: 4096,
      maxResponseBytes: ZEYTUN_BALANCES_MAX_BYTES,
      headers: expect.objectContaining({ Authorization: `Basic ${Buffer.from("test-user:test-only-password").toString("base64")}` }),
    }))
  })
  it("binds caches to tenant, endpoint, account and every request field, but not the password", () => {
    const key = zeytunBalanceScopeKey(config)
    for (const changed of [
      { ...config, organizationId: "other" }, { ...config, username: "other" },
      { ...config, endpoint: "https://other.example/AvailableBalances" },
      ...["GUID", "Warehouse"].map((field) => ({ ...config, request: { ...config.request, [field]: "99999999-2222-4333-8444-555555555555" } })),
      { ...config, request: { ...config.request, METRO: true } },
    ]) expect(zeytunBalanceScopeKey(changed)).not.toBe(key)
    expect(zeytunBalanceScopeKey({ ...config, password: "rotated" })).toBe(key)
  })
  it("requires the exact request contract before sending credentials", async () => {
    const download = vi.fn()
    for (const request of [undefined, {}, { ...config.request, Guid: guid }, { ...config.request, METRO: "false" }, { ...config.request, Warehouse: "bad" }]) {
      await expect(readZeytunAvailableBalances({ ...config, request }, download)).rejects.toThrow("invalid_configuration")
    }
    expect(download).not.toHaveBeenCalled()
  })
  it("requires a server opt-in for HTTP before sending any credentials", async () => {
    const download = vi.fn().mockResolvedValue(response())
    const http = { ...config, endpoint: "http://inventory.example:6540/AvailableBalances" }
    await expect(readZeytunAvailableBalances(http, download)).rejects.toThrow("https_required")
    expect(download).not.toHaveBeenCalled()
    await readZeytunAvailableBalances({ ...http, allowPlainHttp: true }, download)
    expect(download).toHaveBeenCalledTimes(1)
    expect(download.mock.calls[0][1].allowHttp).toBe(true)
  })
  it.each([401, 403, 500, 302])("does not retry or leak the error body for HTTP %s", async (status) => {
    const download = vi.fn().mockResolvedValue(response({ status, ok: false, bodyBytes: Buffer.from("private upstream response") }))
    await expect(readZeytunAvailableBalances(config, download)).rejects.toThrow(status === 401 || status === 403 ? "authentication_required" : "upstream_unavailable")
    expect(download).toHaveBeenCalledTimes(1)
  })
  it("turns invalid response/transport failures into non-sensitive error codes", async () => {
    await expect(readZeytunAvailableBalances(config, vi.fn().mockResolvedValue(response({ bodyBytes: Buffer.from("private malformed body") }))))
      .rejects.toThrow("invalid_response")
    await expect(readZeytunAvailableBalances(config, vi.fn().mockRejectedValue(new Error("password from upstream"))))
      .rejects.toThrow("upstream_unavailable")
  })
  it("rejects URL credentials, query secrets and invalid authentication fields before transport", async () => {
    const download = vi.fn()
    for (const input of [
      { ...config, endpoint: "https://user:password@inventory.example/AvailableBalances" },
      { ...config, endpoint: "https://inventory.example/AvailableBalances?key=secret" },
      { ...config, endpoint: "file:///tmp/data" }, { ...config, username: "bad:name" }, { ...config, password: "" },
    ]) await expect(readZeytunAvailableBalances(input, download)).rejects.toThrow("invalid_configuration")
    expect(download).not.toHaveBeenCalled()
  })
  it("actually enforces the shared transport's private-address and redirect fences", async () => {
    const transport = vi.fn()
    await expect(readZeytunAvailableBalances(config, (url, options) => postOutboundResource(url, {
      ...options, resolver: async () => [{ address: "127.0.0.1", family: 4 }], transport,
    }))).rejects.toThrow("upstream_unavailable")
    expect(transport).not.toHaveBeenCalled()
    transport.mockResolvedValue({ status: 302, location: "https://elsewhere.example/secret" })
    await expect(readZeytunAvailableBalances(config, (url, options) => postOutboundResource(url, {
      ...options, resolver: async () => [{ address: "8.8.8.8", family: 4 }], transport,
    }))).rejects.toThrow("upstream_unavailable")
    expect(transport).toHaveBeenCalledTimes(1)
    expect(transport.mock.calls[0][1].method).toBe("POST")
  })
  it("lists the catalog's makers for the recognizer, most frequent first, without placeholders", () => {
    const item = (n: number, ru: string, az: string | null) => {
      const r = row()
      return { ...r, Номенклатура: { ...r.Номенклатура, Guid: `11111111-2222-4333-8444-${String(n).padStart(12, "0")}`,
        Номер: `SN-${n}`, Наименование: ru, НаименованиеАз: az ?? "", МассивШтрихкодов: [] } }
    }
    const feed = new ZeytunAvailableBalances(payload([
      item(1, "Парацетамол 0,5 гр № 20 (Таблетки) (Sopharma ) (Болгария)", "Parasetamol 500 mq № 20 /*qutu/* \\*Sopharma Asc , Bolqarıstan\\*"),
      item(2, "Темпалгин № 10 (Таблетки) (Sopharma) (Болгария)", null),
      item(3, "Мезим форте № 20 (Таблетки) (Berlin-Chemie) (Германия)", "Mezim forte 10 000 Vah № 20 (Həb) (Berlin-Chemie) (Almaniya)"),
      item(4, "Нимесил № 30 (Саше) (Berlin-Chemie) (Германия)", null),
      item(5, "Масло № 1 (Масло) (Прочее) (Азербайджан)", null),
      item(6, "Масло № 2 (Масло) (Прочее) (Азербайджан)", null),
      item(7, "Одиночка № 1 (Таблетки) (Rarefarm) (Индия)", null),
    ]), context)
    // Sopharma three times (twice in Russian labels, once in the Azerbaijani
    // marker), Berlin-Chemie twice; a maker seen once and "Прочее" are left out.
    expect(feed.manufacturerWords()).toEqual(["Sopharma", "Berlin-Chemie"])
    expect(feed.manufacturerWords(1)).toEqual(["Sopharma"])
  })
})

describe("Zeytun feed built a slice at a time", () => {
  // 2026-10-28 on prod: building the 14 MB feed held the web process 3.2 s.
  const many = Array.from({ length: 300 }, (_, n) => {
    const r = row()
    return { ...r, Номенклатура: { ...r.Номенклатура, Guid: `11111111-2222-4333-8444-${String(n).padStart(12, "0")}`, Номер: `SN-${n}`,
      Наименование: `${["Адефа", "Кетонал", "Но-шпа", "Тестмедин"][n % 4]} ${n} мг № 20 (Таблетки) (${["Sopharma", "KRKA"][n % 2]} ) (Болгария)`,
      НаименованиеАз: n % 3 ? "" : `Preparat ${n} \\*Sopharma Asc , Bolqarıstan\\*`,
      МассивШтрихкодов: [{ ТипШтрихкода: "EAN13", Штрихкод: `48${String(n).padStart(11, "0")}` }] } }
  })

  it("answers exactly as the feed built at once", async () => {
    const at = new ZeytunAvailableBalances(payload(many), context)
    const sliced = await ZeytunAvailableBalances.build(payload(many), context, 0)
    expect(sliced.summary("tenant-test")).toEqual(at.summary("tenant-test"))
    expect(sliced.manufacturerWords()).toEqual(at.manufacturerWords())
    for (const query of [{ text: "Adefa" }, { text: "Noşpa 20" }, { text: "ketanol" }, { text: "Preparat 30" },
      { itemCode: "SN-7" }, { barcode: "4800000000042" }, { externalId: many[5].Номенклатура.Guid }]) {
      expect(sliced.search("tenant-test", query)).toEqual(at.search("tenant-test", query))
    }
    // Cyrillic name, Latin words: the line's case from the 2026-10-28 call.
    expect(sliced.search("tenant-test", { text: "Adefa" }).candidates[0].name).toMatch(/^Адефа/u)
  })

  it("lets the event loop run between rows", async () => {
    let turns = 0, running = true
    const spin = () => { if (running) { turns++; setImmediate(spin) } }
    setImmediate(spin)
    await ZeytunAvailableBalances.build(payload(many), context, 0)
    running = false
    // Decode, parse, and one turn per row at the least.
    expect(turns).toBeGreaterThanOrEqual(many.length)
  })

  it("rejects what the feed built at once rejects", async () => {
    const bad = row()
    bad.Номенклатура.Guid = "00000000-0000-0000-0000-000000000000"
    for (const input of [payload([row(), row()]), payload([bad]), payload([{ Цена: 5 }]), payload([]), "<html>not JSON</html>",
      Uint8Array.from([0xff, 0xfe])]) {
      await expect(ZeytunAvailableBalances.build(input, context)).rejects.toThrow("invalid_catalog")
    }
  })
})
