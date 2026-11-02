import { z } from "zod"

const identifier = z.string().trim().min(1).max(128)
const guid = z.uuid().refine((value) => value !== "00000000-0000-0000-0000-000000000000")
  .transform((value) => value.toLowerCase())
const phone = z.string().regex(/^\+[1-9]\d{7,14}$/)
const subject = z.strictObject({ kind: z.enum(["contact", "lead"]), id: identifier })
const schema = z.strictObject({
  organizationId: identifier, version: identifier,
  capturedAt: z.iso.datetime({ offset: true }), expiresAt: z.iso.datetime({ offset: true }),
  bindings: z.array(z.strictObject({
    id: identifier, subject,
    counterpartyGuid: guid, warehouseGuid: guid, metro: z.boolean(),
    phoneNumbersE164: z.array(phone).min(1).max(20), active: z.boolean(),
    // Server-maintained review evidence; an upstream GUID/phone is insufficient.
    reviewedByUserId: identifier, reviewedAt: z.iso.datetime({ offset: true }), evidenceId: identifier,
  })).max(50_000),
})
export type ZeytunCustomerBinding = z.infer<typeof schema>["bindings"][number]
type Subject = z.infer<typeof subject>
export type ZeytunBindingResult =
  | { status: "bound"; binding: ZeytunCustomerBinding; version: string }
  | { status: "review_required"; reason: "directory_unavailable" | "not_mapped" | "phone_conflict" | "ambiguous" | "inactive" }

export class ZeytunCustomerBindingError extends Error {
  constructor() { super("invalid_customer_bindings"); this.name = "ZeytunCustomerBindingError" }
}

function subjectKey(value: Subject): string { return JSON.stringify([value.kind, value.id]) }
function targetKey(value: ZeytunCustomerBinding): string {
  return JSON.stringify([value.counterpartyGuid, value.warehouseGuid, value.metro])
}

/** Normalized, operator-reviewed CRM mappings, NOT a guessed 1C response schema.
 * Construct once per verified version; publish a complete replacement to revoke.
 * Phone lookup can detect ambiguity but can never select a customer by itself.
 */
export class ZeytunCustomerBindings {
  private readonly data: z.infer<typeof schema>
  private readonly bySubject = new Map<string, ZeytunCustomerBinding[]>()
  private readonly phoneTargets = new Map<string, Set<string>>()

  constructor(input: unknown) {
    const parsed = schema.safeParse(input)
    if (!parsed.success) throw new ZeytunCustomerBindingError()
    this.data = parsed.data
    const captured = Date.parse(this.data.capturedAt)
    if (Date.parse(this.data.expiresAt) <= captured) throw new ZeytunCustomerBindingError()
    const ids = new Set<string>()
    for (const binding of this.data.bindings) {
      if (ids.has(binding.id) || Date.parse(binding.reviewedAt) > captured || new Set(binding.phoneNumbersE164).size !== binding.phoneNumbersE164.length) {
        throw new ZeytunCustomerBindingError()
      }
      ids.add(binding.id)
      const key = subjectKey(binding.subject)
      const matches = this.bySubject.get(key) ?? []
      matches.push(binding)
      this.bySubject.set(key, matches)
      if (!binding.active) continue
      for (const number of binding.phoneNumbersE164) {
        const targets = this.phoneTargets.get(number) ?? new Set<string>()
        targets.add(targetKey(binding))
        this.phoneTargets.set(number, targets)
      }
    }
  }

  resolve(organizationId: string, crmSubject: Subject, phoneE164: string, now = Date.now()): ZeytunBindingResult {
    if (organizationId !== this.data.organizationId || !Number.isFinite(now) ||
        now < Date.parse(this.data.capturedAt) || now >= Date.parse(this.data.expiresAt)) {
      return { status: "review_required", reason: "directory_unavailable" }
    }
    const matching = this.bySubject.get(subjectKey(crmSubject)) ?? []
    if (!matching.length) return { status: "review_required", reason: "not_mapped" }
    // Do not filter by the cache's warehouse or silently choose one of two rows.
    if (matching.length !== 1) return { status: "review_required", reason: "ambiguous" }
    const binding = matching[0]
    if (!binding.active) return { status: "review_required", reason: "inactive" }
    if (!binding.phoneNumbersE164.includes(phoneE164)) return { status: "review_required", reason: "phone_conflict" }
    if ((this.phoneTargets.get(phoneE164)?.size ?? 0) !== 1) return { status: "review_required", reason: "ambiguous" }
    return { status: "bound", binding: structuredClone(binding), version: this.data.version }
  }
}
