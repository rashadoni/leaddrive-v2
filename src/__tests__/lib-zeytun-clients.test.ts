import { describe, expect, it, vi } from "vitest"

import { decodeZeytunClientsSoap, fetchZeytunClientsSoap, parseZeytunClientsConfig, zeytunClientsScopeKey, ZEYTUN_CLIENTS_MAX_BYTES } from "@/lib/voice-agent/pharmacy/zeytun-clients-client"
import { ZeytunClientsDirectory, normalizeZeytunClientPhone } from "@/lib/voice-agent/pharmacy/zeytun-clients-directory"
import { clientGuid, otherClientGuid, clientStamp, clientContext, clientRow, clientsXml } from "./fixtures/zeytun-clients"

const config = { organizationId: "tenant-test", endpoint: "https://clients.example/ws/service.1cws", username: "test-user", password: "test-password" }
function envelope(value: string, escaped = false) {
  const text = escaped ? value : value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><m:ListClientsResponse xmlns:m="ZTNMOBILE"><m:return>${text}</m:return></m:ListClientsResponse></s:Body></s:Envelope>`
}
function decode(value: string) { return decodeZeytunClientsSoap(Buffer.from(value)) }
const response = (body = envelope("test result")) => ({ ok: true, status: 200, url: config.endpoint, redirects: 0, bodyBytes: Buffer.from(body) })

describe("observed XML customer directory", () => {
  const now = Date.parse(clientStamp)
  it("uses GUIDE for the customer, keeps chain separate and excludes finance/mail/unknown fields", () => {
    const data = clientsXml([clientRow({ chainGUIDE: otherClientGuid, chain: "Test network", Name: 'Sınaq & <label>', Secret: "never copy" })])
    const directory = new ZeytunClientsDirectory(data, clientContext)
    expect(directory.get("tenant-test", clientGuid)).toMatchObject({ counterpartyGuid: clientGuid, name: 'Sınaq & <label>', chain: { guid: otherClientGuid }, phoneE164: "+994500000001", authorizationVerified: false })
    expect(directory.get("tenant-test", otherClientGuid)).toBeNull()
    expect(JSON.stringify(directory.get("tenant-test", clientGuid))).not.toMatch(/balance|debet|kredit|mail|never copy/i)
  })
  it("never picks the first shared phone, including differently formatted duplicates", () => {
    const rows = Array.from({ length: 7 }, (_, i) => clientRow({ GUIDE: `11111111-2222-4333-8444-${String(i).padStart(12, "0")}`, Phone: i % 2 ? "+994 (50) 000-00-01" : "994500000001" }))
    const directory = new ZeytunClientsDirectory(clientsXml(rows), clientContext)
    expect(directory.summary("tenant-test")).toMatchObject({ clientCount: 7, sharedPhoneCount: 1, clientsWithSharedPhoneCount: 7 })
    expect(directory.findByPhone("tenant-test", "+994500000001")).toMatchObject({ candidateCount: 7, requiresReview: true, canAuthorizeCall: false })
    expect(directory.findByPhone("tenant-test", "+994500000001").candidates).toHaveLength(5)
    expect(directory.checkBinding("tenant-test", rows[0].GUIDE, "+994500000001", now)).toMatchObject({ consistent: false, reason: "ambiguous" })
  })
  it.each(["994500000001", " +994 (50) 000-00-01 ", "99450 000 00 01"])("normalizes explicit international notation %s", (phone) => {
    expect(normalizeZeytunClientPhone(phone)).toBe("+994500000001")
  })
  it.each(["", "0500000001", "500000001", "99450000000199", "+994, 0500000001", "994500000001 ext 4", "+9945000000019", "99450x000001"])("does not guess incomplete/malformed phone %s", (phone) => {
    expect(normalizeZeytunClientPhone(phone)).toBeNull()
  })
  it("keeps records with missing/unsupported phones, without authorizing calls", () => {
    const directory = new ZeytunClientsDirectory(clientsXml([clientRow({ Phone: "" }), clientRow({ GUIDE: otherClientGuid, Phone: "0500000001" })]), clientContext)
    expect(directory.summary("tenant-test")).toMatchObject({ missingPhoneCount: 1, unrecognizedPhoneCount: 1 })
    expect(directory.checkBinding("tenant-test", clientGuid, "+994500000001", now).consistent).toBe(false)
  })
  it("checks tenant, freshness, source and exact phone after an independent CRM review", () => {
    const directory = new ZeytunClientsDirectory(clientsXml(), clientContext)
    expect(directory.checkBinding("tenant-test", clientGuid, "+994500000001", now).consistent).toBe(true)
    for (const time of [now - 1, now + 86_400_000, NaN]) expect(directory.checkBinding("tenant-test", clientGuid, "+994500000001", time).consistent).toBe(false)
    expect(directory.checkBinding("other", clientGuid, "+994500000001", now).consistent).toBe(false)
    expect(directory.checkBinding("tenant-test", otherClientGuid, "+994500000001", now)).toMatchObject({ reason: "not_found" })
    expect(directory.checkBinding("tenant-test", clientGuid, "+994500000002", now)).toMatchObject({ reason: "phone_conflict" })
    expect(new ZeytunClientsDirectory(clientsXml(), { ...clientContext, source: "attachment" }).checkBinding("tenant-test", clientGuid, "+994500000001", now).consistent).toBe(false)
    expect(() => directory.get("other", clientGuid)).toThrow("tenant_mismatch")
    expect(() => directory.summary("other")).toThrow("tenant_mismatch")
    expect(() => directory.findByPhone("other", "+994500000001")).toThrow("tenant_mismatch")
    expect(() => directory.findByPhone("tenant-test", "0500000001")).toThrow("invalid_query")
    const item = directory.get("tenant-test", clientGuid)!; item.phoneE164 = "+994500000002"
    expect(directory.get("tenant-test", clientGuid)!.phoneE164).toBe("+994500000001")
  })
  it("rejects partial/duplicate/malformed/empty replacements as a whole, without quoting data", () => {
    const row = clientRow(); delete (row as Partial<typeof row>).GUIDE
    const valid = clientsXml().toString()
    for (const bad of [clientsXml([row]), clientsXml([clientRow(), clientRow()]), clientsXml([]),
      clientsXml([clientRow({ GUIDE: "00000000-0000-0000-0000-000000000000" })]),
      Buffer.from(valid.replace("<Корневой>", '<Корневой xmlns="unexpected">')),
      Buffer.from(valid.replace("/>", "><nested/></Data>")),
      Buffer.from('<!DOCTYPE Корневой [<!ENTITY x SYSTEM "file:///private">]>' + valid),
      Buffer.from("<Корневой><Data Name=\"private name\"/></Корневой>"), Uint8Array.from([0xff]),
      new Uint8Array(ZEYTUN_CLIENTS_MAX_BYTES + 1)]) {
      expect(() => new ZeytunClientsDirectory(bad, clientContext)).toThrow("invalid_directory")
    }
  })
})

describe("bounded namespace-aware ListClients SOAP", () => {
  it("accepts verified SOAP 1.1, prefixes/default namespace, BOM, CDATA and escaped text exactly once", () => {
    const value = 'Sınaq & <label> &amp; "not instructions"'
    expect(decode(envelope(value))).toBe(value)
    expect(decode(`\uFEFF${envelope(value)}`)).toBe(value)
    expect(decode(envelope(`<![CDATA[${value}]]>`, true))).toBe(value)
    expect(decode(envelope(value).replace(/m:/g, "").replace("xmlns:m=", "xmlns="))).toBe(value)
    expect(decode(envelope(value).replace("<m:return>", '<m:return xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="xs:string">'))).toBe(value)
  })
  it.each([
    "", "<html>private upstream error</html>",
    envelope("x").replace("ZTNMOBILE", "attacker"),
    envelope("x").replace("soap/envelope/", "soap12/envelope/"),
    envelope("x").replace("</m:return>", "</m:return><m:return>second</m:return>"),
    envelope("x").replace("</s:Body>", "</s:Body><s:Body/>"),
    envelope("x").replace("<m:return>", '<m:return xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true">'),
    envelope("x").replace("<m:return>", "<m:return><injected/>"),
    envelope("x").replace("<s:Body>", "<s:Body>unexpected"),
    envelope("&unknown;", true),
    envelope("x").replace("ListClientsResponse", "Fault"),
    '<!DOCTYPE s:Envelope [<!ENTITY secret SYSTEM "file:///private">]>' + envelope("&secret;", true),
    '<?xml-stylesheet href="https://private.example"?>' + envelope("x"),
    '<?xml version="1.0" encoding="UTF-16"?>' + envelope("x"),
  ])("rejects malformed, ambiguous or unsupported envelopes %#", (xml) => {
    expect(() => decode(xml)).toThrow("invalid_response")
  })
  it("rejects invalid UTF-8 and bytes above the limit", () => {
    expect(() => decodeZeytunClientsSoap(Uint8Array.from([0xff]))).toThrow("invalid_response")
    expect(() => decodeZeytunClientsSoap(new Uint8Array(ZEYTUN_CLIENTS_MAX_BYTES + 1))).toThrow("invalid_response")
  })
})

describe("ListClients transport", () => {
  it("uses only Pharmacy, the verified action and one bounded read with no redirects", async () => {
    const download = vi.fn().mockResolvedValue(response())
    const read = await fetchZeytunClientsSoap(config, download)
    expect(read.payload.toString()).toBe("test result")
    expect(read.context).toMatchObject({ organizationId: "tenant-test", source: "live" })
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith(config.endpoint, expect.objectContaining({
      allowHttp: false, allowedHosts: ["clients.example"], timeoutMs: 300_000,
      maxRedirects: 0, maxBodyBytes: 4096, maxResponseBytes: ZEYTUN_CLIENTS_MAX_BYTES,
      body: expect.stringContaining("<param1>Pharmacy</param1>"),
      headers: expect.objectContaining({ SOAPAction: '"ZTNMOBILE#ZTNMOBILE:ListClients"', "Content-Type": "text/xml; charset=utf-8" }),
    }))
  })
  it.each([401, 403, 500, 302, 204])("masks failure %i without leaking a SOAP fault or credentials", async (status) => {
    const download = vi.fn().mockResolvedValue({ ...response("private fault"), status, ok: status === 204 })
    await expect(fetchZeytunClientsSoap(config, download)).rejects.toThrow([401, 403].includes(status) ? "authentication_required" : "upstream_unavailable")
    expect(download).toHaveBeenCalledTimes(1)
  })
  it("masks transport exceptions and never retries", async () => {
    const download = vi.fn().mockRejectedValue(new Error("private credentials"))
    await expect(fetchZeytunClientsSoap(config, download)).rejects.toThrow("upstream_unavailable")
    expect(download).toHaveBeenCalledTimes(1)
  })
  it("requires explicit HTTP opt-in; rejects URL credentials/query/fragment and model-selected operations", () => {
    expect(() => parseZeytunClientsConfig({ ...config, endpoint: "http://clients.example/ws" })).toThrow("https_required")
    expect(parseZeytunClientsConfig({ ...config, endpoint: "http://clients.example/ws", allowPlainHttp: true }).allowPlainHttp).toBe(true)
    for (const endpoint of ["https://user:pass@clients.example/ws", "https://clients.example/ws?wsdl", "https://clients.example/ws#fragment", "file:///private"]) {
      expect(() => parseZeytunClientsConfig({ ...config, endpoint })).toThrow("invalid_configuration")
    }
    expect(() => parseZeytunClientsConfig({ ...config, method: "WriteOrder" })).toThrow("invalid_configuration")
  })
  it("separates tenant/account/source scopes while retaining scope after password rotation", () => {
    const key = zeytunClientsScopeKey(config)
    expect(zeytunClientsScopeKey({ ...config, password: "new-secret" })).toBe(key)
    for (const change of [{ organizationId: "other" }, { username: "other" }, { endpoint: "https://other.example/ws" }]) {
      expect(zeytunClientsScopeKey({ ...config, ...change })).not.toBe(key)
    }
  })
})
