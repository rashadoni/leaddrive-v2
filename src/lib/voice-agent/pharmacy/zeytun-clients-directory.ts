import { createHash } from "node:crypto"
import { TextDecoder } from "node:util"
import { SaxesParser } from "saxes"
import { z } from "zod"

import { ZEYTUN_CLIENTS_MAX_BYTES } from "./zeytun-clients-client"

const nil = "00000000-0000-0000-0000-000000000000"
const guid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).transform((v) => v.toLowerCase())
const customerGuid = guid.refine((v) => v !== nil)
const text = z.string().trim().max(512)
const rowSchema = z.object({
  Name: text.min(1), chain: text, chainGUIDE: guid, GUIDE: customerGuid,
  Region: text, Adress: text, Phone: text, Mail: text,
  // Present in the observed wire contract; never interpreted as credit/permission.
  balance: text, Debet: text, Kredit: text,
})
const contextSchema = z.strictObject({
  organizationId: z.string().trim().min(1).max(128), observedAt: z.iso.datetime({ offset: true }),
  source: z.enum(["attachment", "live"]),
})
export type ZeytunClientsContext = z.infer<typeof contextSchema>
export class ZeytunClientsDirectoryError extends Error {
  constructor(readonly code: "invalid_directory" | "tenant_mismatch" | "invalid_query") { super(code); this.name = "ZeytunClientsDirectoryError" }
}

/** Syntactic candidate only, not ownership or dialability verification.
 * The observed full 994 + nine digits is explicit international notation.
 * National numbers, extensions, comma lists and malformed lengths need review.
 */
export function normalizeZeytunClientPhone(value: string): string | null {
  const compact = value.trim().replace(/[\s()\-]/g, "")
  if (/^994\d{9}$/.test(compact)) return `+${compact}`
  if (/^\+[1-9]\d{7,14}$/.test(compact) && (!compact.startsWith("+994") || /^\+994\d{9}$/.test(compact))) return compact
  return null
}
function mapRow(row: z.infer<typeof rowSchema>) {
  const phoneE164 = normalizeZeytunClientPhone(row.Phone)
  return {
    counterpartyGuid: row.GUIDE, name: row.Name,
    chain: { guid: row.chainGUIDE === nil ? null : row.chainGUIDE, name: row.chain || null },
    region: row.Region, address: row.Adress, phoneAsReported: row.Phone, phoneE164,
    phoneStatus: !row.Phone ? "missing" as const : phoneE164 ? "normalized_candidate" as const : "review_required" as const,
    // No upstream active/permission/credit status exists in this contract.
    authorizationVerified: false as const,
  }
}
type Client = ReturnType<typeof mapRow>

/** Internal directory for reconciliation. Never include it in an LLM prompt.
 * Build a complete replacement off the call path, then swap the reference.
 */
export class ZeytunClientsDirectory {
  private readonly context: ZeytunClientsContext
  private readonly version: string
  private readonly clients = new Map<string, Client>()
  private readonly phones = new Map<string, Set<string>>()
  private readonly counts: { missingPhoneCount: number; unrecognizedPhoneCount: number; sharedPhoneCount: number; clientsWithSharedPhoneCount: number }

  constructor(payload: Uint8Array, context: ZeytunClientsContext) {
    try {
      this.context = contextSchema.parse(context)
      if (!payload.byteLength || payload.byteLength > ZEYTUN_CLIENTS_MAX_BYTES) throw new Error()
      const xml = new TextDecoder("utf-8", { fatal: true }).decode(payload)
      if (/<!DOCTYPE|<!ENTITY/.test(xml)) throw new Error()
      const parser = new SaxesParser({ xmlns: true })
      let depth = 0
      let rootSeen = false
      parser.on("error", () => { throw new Error() })
      parser.on("doctype", () => { throw new Error() })
      parser.on("processinginstruction", () => { throw new Error() })
      parser.on("xmldecl", (decl) => {
        if (decl.version !== "1.0" || (decl.encoding && decl.encoding.toLowerCase() !== "utf-8")) throw new Error()
      })
      parser.on("opentag", (tag) => {
        if (tag.uri || depth > 1) throw new Error()
        if (depth === 0) {
          if (rootSeen || tag.local !== "Корневой" || Object.keys(tag.attributes).length) throw new Error()
          rootSeen = true
        } else {
          if (tag.local !== "Data" || this.clients.size >= 50_000 || Object.keys(tag.attributes).length > 32) throw new Error()
          const attrs: Record<string, string> = Object.create(null)
          for (const attr of Object.values(tag.attributes)) {
            if (attr.uri || attr.value.length > 512) throw new Error()
            attrs[attr.local] = attr.value
          }
          const item = mapRow(rowSchema.parse(attrs))
          if (this.clients.has(item.counterpartyGuid)) throw new Error()
          this.clients.set(item.counterpartyGuid, item)
          if (item.phoneE164) {
            const ids = this.phones.get(item.phoneE164) ?? new Set<string>()
            ids.add(item.counterpartyGuid); this.phones.set(item.phoneE164, ids)
          }
        }
        depth++
      })
      parser.on("closetag", () => { depth-- })
      const whitespaceOnly = (value: string) => { if (value.trim()) throw new Error() }
      parser.on("text", whitespaceOnly); parser.on("cdata", whitespaceOnly)
      parser.write(xml).close()
      if (!rootSeen || depth !== 0 || !this.clients.size) throw new Error()
      this.version = createHash("sha256").update(payload).digest("hex")
      this.counts = { missingPhoneCount: 0, unrecognizedPhoneCount: 0, sharedPhoneCount: 0, clientsWithSharedPhoneCount: 0 }
      for (const item of this.clients.values()) {
        if (item.phoneStatus === "missing") this.counts.missingPhoneCount++
        if (item.phoneStatus === "review_required") this.counts.unrecognizedPhoneCount++
      }
      for (const ids of this.phones.values()) if (ids.size > 1) {
        this.counts.sharedPhoneCount++; this.counts.clientsWithSharedPhoneCount += ids.size
      }
    } catch { throw new ZeytunClientsDirectoryError("invalid_directory") }
  }

  summary(organizationId: string) {
    this.assertTenant(organizationId)
    return { ...this.context, version: this.version, clientCount: this.clients.size, ...this.counts,
      coverage: "unverified" as const, sourceGeneratedAt: null, canAuthorizeCall: false as const }
  }

  get(organizationId: string, id: string): Client | null {
    this.assertTenant(organizationId)
    const parsed = customerGuid.safeParse(id)
    if (!parsed.success) throw new ZeytunClientsDirectoryError("invalid_query")
    const item = this.clients.get(parsed.data)
    return item ? structuredClone(item) : null
  }

  /** Every pharmacy, for the CRM's company cards (never for a prompt). */
  all(organizationId: string): Client[] {
    this.assertTenant(organizationId)
    return [...this.clients.values()].map((item) => structuredClone(item))
  }

  /** Display candidates for a human review; even one match is not a CRM binding. */
  findByPhone(organizationId: string, phone: string) {
    this.assertTenant(organizationId)
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new ZeytunClientsDirectoryError("invalid_query")
    const ids = [...(this.phones.get(phone) ?? [])]
    return { candidateCount: ids.length, candidates: ids.slice(0, 5).map((id) => structuredClone(this.clients.get(id)!)),
      requiresReview: true as const, canAuthorizeCall: false as const }
  }

  /** Extra source-consistency gate AFTER a reviewed CRM binding. No authorization
   * is created here. Missing, shared, expired or conflicting evidence fails closed.
   */
  checkBinding(organizationId: string, id: string, phoneE164: string, now = Date.now()) {
    if (organizationId !== this.context.organizationId || !Number.isFinite(now) || this.context.source !== "live" ||
        now < Date.parse(this.context.observedAt) || now - Date.parse(this.context.observedAt) >= 86_400_000) return { consistent: false, reason: "directory_unavailable" } as const
    const parsed = customerGuid.safeParse(id)
    const item = parsed.success ? this.clients.get(parsed.data) : null
    if (!item) return { consistent: false, reason: "not_found" } as const
    if (!item.phoneE164 || item.phoneE164 !== phoneE164) return { consistent: false, reason: "phone_conflict" } as const
    if (this.phones.get(phoneE164)?.size !== 1) return { consistent: false, reason: "ambiguous" } as const
    return { consistent: true, version: this.version } as const
  }

  private assertTenant(organizationId: string) {
    if (organizationId !== this.context.organizationId) throw new ZeytunClientsDirectoryError("tenant_mismatch")
  }
}
