/**
 * What the line's stands share (dialog-stand.ts, voice-stand.ts): the CRM's
 * own handler on a catalog snapshot, and the station's own tool bridge
 * (dialog-stand-bridge.py loads scripts/pbx/fanum-zeytun-inbound.py). Only
 * the order writer, cancel and transfer are stubs; nothing leaves this machine.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import type { Readable, Writable } from "node:stream"
import { fileURLToPath } from "node:url"

import { ZeytunAvailableBalances } from "../../src/lib/voice-agent/pharmacy/zeytun-available-balances"
import { createInboundPilotHandler, type InboundPilotCatalog } from "../../src/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { resolvePhoneOrderLines, type PhoneOrderLineInput } from "../../src/lib/voice-agent/pharmacy/phone-orders"
import { createDepartedSearch, nextDeparted } from "../../src/lib/voice-agent/pharmacy/zeytun-departed-items"
import type { PharmacyHistory } from "../../src/lib/voice-agent/pharmacy/zeytun-pharmacy-history"
import type { ZeytunSecondEar } from "../../src/lib/voice-agent/pharmacy/zeytun-chirp"

const HERE = dirname(fileURLToPath(import.meta.url))

export type Json = Record<string, unknown>
/** The pharmacy's last confirmed order as the CRM's pharmacyHistory answers it: a line names a
 * product of the snapshot by a search (its first candidate), or one the catalog no longer has. */
export type HistorySpec = { number: number; orderedAt: string
  lines: ({ find: string; quantity: number; unit: string } | { name: string; quantity: number; unit: string })[] }
/** One save of the call, with the product each line resolved to (null: not found). */
export type Save = { lines: PhoneOrderLineInput[]; final: boolean; products?: (string | null)[] }

/** A transcript as the voice stand's hear patterns read it: plain Latin, lower case (ə→e, ı→i, ş→s, ç→c, ğ→g, ö→o, ü→u). */
export const foldLatin = (text: string) => text.toLowerCase().replaceAll("i̇", "i").replaceAll("ə", "e").replaceAll("ı", "i")
  .replaceAll("ş", "s").replaceAll("ç", "c").replaceAll("ğ", "g").replaceAll("ö", "o").replaceAll("ü", "u")

/* ---------- the station's bridge ---------- */

export class StationBridge {
  /** stderr is inherited: the bridge's own errors go straight to the stand's stderr. */
  private child: ChildProcessByStdio<Writable, Readable, null>
  private waiting: ((value: { done?: unknown; error?: string }) => void)[] = []
  constructor(private crm: (body: Json) => Promise<unknown>, station?: string) {
    this.child = spawn("python3", ["-I", join(HERE, "dialog-stand-bridge.py"), ...(station ? ["--station", station] : [])], { stdio: ["pipe", "pipe", "inherit"] })
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const message = JSON.parse(line) as { crm?: number; body?: Json; done?: unknown; error?: string }
      if (message.crm !== undefined) {
        void this.crm(message.body ?? {}).then((value) => this.send({ reply: message.crm, value }), () => this.send({ reply: message.crm, value: null }))
      } else this.waiting.shift()?.(message)
    })
  }
  private send(value: unknown) { this.child.stdin.write(`${JSON.stringify(value)}\n`) }
  async op<T>(value: Json): Promise<T> {
    const answer = await new Promise<{ done?: unknown; error?: string }>((resolve) => { this.waiting.push(resolve); this.send(value) })
    if (answer.error) throw new Error(`station bridge: ${answer.error}`)
    return answer.done as T
  }
  close() { this.child.stdin.end() }
}

/* ---------- the CRM on a snapshot ---------- */

async function loadFeed(path: string) {
  const raw = readFileSync(path), newline = raw.indexOf(10)
  const header = JSON.parse(raw.subarray(0, newline).toString()) as { organizationId: string; scopeKey: string; version: string; observedAt: string }
  // The handler serves a catalog at most a day old; the stand reads it as observed now.
  const observedAt = new Date().toISOString()
  return { header, observedAt, feed: await ZeytunAvailableBalances.build(raw.subarray(newline + 1), { organizationId: header.organizationId, observedAt, source: "live" }) }
}

/** `departedFrom`: an older snapshot of the same scope; what it had and this one lacks is sold out, as the refresh records it. */
export async function loadCatalog(path: string, departedFrom?: string): Promise<{ catalog: InboundPilotCatalog; snapshotAt: string; soldOut: number }> {
  const { header, observedAt, feed } = await loadFeed(path)
  const before = departedFrom ? (await loadFeed(departedFrom)).feed : null
  const departed = before ? nextDeparted({ previous: [], before: before.labels(header.organizationId), now: feed.labels(header.organizationId), at: Date.now() }) : []
  return {
    snapshotAt: header.observedAt, soldOut: departed.length,
    catalog: { organizationId: header.organizationId, scopeKey: header.scopeKey, version: header.version, observedAt, source: "live",
      search: (query) => feed.search(header.organizationId, query), seller: feed.seller(header.organizationId),
      ...(departed.length ? { departed: createDepartedSearch(departed) } : {}) } as InboundPilotCatalog,
  }
}

export function historyFor(catalog: InboundPilotCatalog, spec: HistorySpec): PharmacyHistory {
  const lines = spec.lines.map((line) => {
    if ("name" in line) return { externalId: randomUUID(), name: line.name, quantity: line.quantity, unit: line.unit }
    const item = catalog.search({ text: line.find }).candidates[0]
    if (!item) throw new Error(`history: nothing in the snapshot for ${line.find}`)
    return { externalId: item.externalId, name: item.nameAz ?? item.name, quantity: line.quantity, unit: line.unit }
  })
  return { status: "found", number: spec.number, orderedAt: spec.orderedAt, lineCount: lines.length, lines }
}

/** secondEar: the line's Chirp (voice-stand.ts); without it the session does not ask the station for phrases. */
export function crmFor(catalog: InboundPilotCatalog, saves: Save[], history?: PharmacyHistory, secondEar?: ZeytunSecondEar) {
  const token = randomUUID().replaceAll("-", "")
  const now = Date.now()
  const config = {
    version: 1, enabled: true, purpose: "zeytun_line", id: randomUUID(), organizationId: "stand-line", channelConfigId: "stand-channel",
    issuedAt: new Date(now - 60_000).toISOString(), approvalReference: "dialog-stand",
    approvedSource: { organizationId: catalog.organizationId, scopeKey: catalog.scopeKey }, orderOrganizationId: "stand-orders",
  }
  const started = new Date(now - 1000).toISOString()
  let revision = 0
  const handler = createInboundPilotHandler(token, {
    loadConfig: async () => config,
    loadCall: async (_config, callId) => ({ id: `call-${callId}`, organizationId: config.organizationId, channelConfigId: config.channelConfigId,
      providerCallId: callId, provider: "asterisk", direction: "inbound", callMode: "ai", status: "in-progress", wasAnswered: true,
      endedAt: null, startedAt: started, fromNumber: "+994500000000", targetPhoneE164: "+994120000000", handoffState: null }),
    loadCatalog: async () => catalog,
    claim: async () => true,
    isClaimed: async () => true,
    findPharmacies: async () => [],
    requestTransfer: async () => "unavailable",
    cancelOrder: async () => "cancelled",
    ...(history ? { pharmacyHistory: async () => history } : {}),
    ...(secondEar ? { secondEar } : {}),
    // The order writer's answer, without a database: the CRM's own line resolution.
    saveOrder: async (_config, _call, orderCatalog, lines, _pharmacy, delivery) => {
      const resolved = resolvePhoneOrderLines(orderCatalog, lines)
      saves.push({ lines, final: delivery?.final === true, products: resolved.map((line) => line.productName) })
      const total = resolved.reduce((sum, line) => sum + (line.lineTotal ? Number(line.lineTotal.toString()) : 0), 0)
      return { status: "saved", orderId: "stand", number: 9001, revision: ++revision, created: revision === 1, changed: true,
        total: total.toFixed(2), currency: "AZN", priced: resolved.filter((line) => line.lineTotal).length,
        unpriced: resolved.filter((line) => line.status === "resolved" && !line.lineTotal).map((line) => line.spokenText),
        notFound: resolved.filter((line) => line.status === "not_found").map((line) => line.spokenText) }
    },
  })
  return async (body: Json) => {
    const response = await handler(new Request("https://stand.invalid/api/internal/voice-agent/pharmacy-inbound", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }))
    return response.json()
  }
}

