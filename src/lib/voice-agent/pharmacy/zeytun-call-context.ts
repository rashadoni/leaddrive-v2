import { z } from "zod"

const id = z.string().min(1).max(128)
const nullableId = id.nullable()
const e164 = z.string().regex(/^\+[1-9]\d{7,14}$/)

// Projection loaded by a tenant-scoped CRM adapter. None of these fields belong
// in model tool arguments, a transcript, or an unauthenticated request body.
const contextSchema = z.strictObject({
  call: z.strictObject({
    id, organizationId: id, providerCallId: z.uuid(), channelConfigId: id,
    provider: z.literal("asterisk"), callMode: z.literal("ai"),
    direction: z.enum(["inbound", "outbound"]), status: z.literal("in-progress"),
    fromNumber: z.string().min(1).max(64), toNumber: z.string().min(1).max(64), targetPhoneE164: e164,
    contactId: nullableId, companyId: nullableId, leadId: nullableId,
    startedAt: z.iso.datetime({ offset: true }), endedAt: z.null(), wasAnswered: z.literal(true),
  }),
  channel: z.strictObject({
    id, organizationId: id, channelType: z.literal("voip"), isActive: z.literal(true),
    settings: z.object({ provider: z.literal("asterisk"), voiceAgentEnabled: z.literal(true) }),
  }),
  subject: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("contact"), id, organizationId: id, companyId: id, isActive: z.literal(true) }),
    z.strictObject({ kind: z.literal("lead"), id, organizationId: id, status: z.enum(["new", "contacted", "qualified", "converted"]) }),
  ]),
  company: z.strictObject({ id, organizationId: id, status: z.literal("active") }).nullable(),
})
export type ZeytunCallContext = z.infer<typeof contextSchema>
export type ZeytunCallLookup = { organizationId: string; channelConfigId: string; providerCallId: string; provider: "asterisk" }

/** Validate one freshly loaded call. Unknown/duplicate calls must be null in the
 * loader, and all records must be selected under tenant RLS. Lead-only outbound
 * calls require an explicitly reviewed lead mapping, never a name/phone guess.
 */
export function validateZeytunCallContext(input: unknown, expected: ZeytunCallLookup, now = Date.now()): ZeytunCallContext | null {
  const parsed = contextSchema.safeParse(input)
  if (!parsed.success || !Number.isFinite(now)) return null
  const value = parsed.data
  const { call, channel, subject, company } = value
  if ([call, channel, subject].some((row) => row.organizationId !== expected.organizationId) ||
      call.providerCallId !== expected.providerCallId || call.provider !== expected.provider ||
      call.channelConfigId !== expected.channelConfigId || channel.id !== expected.channelConfigId) return null
  const age = now - Date.parse(call.startedAt)
  if (age < 0 || age >= 2 * 60 * 60_000) return null
  // Formatting only: never infer a country or discard letters/extensions.
  const externalPhone = (call.direction === "inbound" ? call.fromNumber : call.toNumber).replace(/[\s()-]/gu, "")
  if (externalPhone !== call.targetPhoneE164) return null
  if (subject.kind === "contact") {
    if (call.contactId !== subject.id || call.leadId !== null || !company ||
        company.organizationId !== expected.organizationId || company.id !== subject.companyId ||
        (call.companyId !== null && call.companyId !== company.id)) return null
  } else {
    if (call.leadId !== subject.id || call.contactId !== null || call.companyId !== null || company !== null) return null
  }
  return value
}
