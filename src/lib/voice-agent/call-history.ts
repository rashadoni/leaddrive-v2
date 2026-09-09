import type { Prisma } from "@prisma/client"

export type ConnectedCallHistoryTarget = {
  leadId: string
  targetPhoneE164: string
}

export type ConnectedCallHistory = {
  connectedLeadIds: Set<string>
  connectedPhoneE164s: Set<string>
}

type ConnectedCallHistoryDb = Pick<Prisma.TransactionClient, "callLog">

type ConnectedCallHistoryRow = {
  leadId: string | null
  direction: string
  fromNumber: string
  toNumber: string
  targetPhoneE164: string | null
  callMode: string
  wasAnswered: boolean
  providerOutcome: string | null
  conversationOutcome: string | null
  status: string
  duration: number | null
}

const CANONICAL_E164 = /^\+[1-9]\d{6,14}$/
const AZERBAIJANI_E164 = /^\+994\d{9}$/
export const AI_CONNECTED_PENDING_RESULT = "provider_connected_pending_result"

/**
 * Exact legacy spellings that can be derived from an already-canonical phone.
 *
 * This deliberately excludes suffix/contains matches, arbitrary local numbers,
 * and formatting permutations. The canonical number supplies the country; this
 * helper never infers one from a raw CallLog value.
 */
export function deterministicCallPhoneVariants(phoneE164: string): string[] {
  const canonical = phoneE164.trim()
  if (!CANONICAL_E164.test(canonical)) return []

  const digits = canonical.slice(1)
  const variants = [canonical, digits]
  if (AZERBAIJANI_E164.test(canonical)) {
    variants.push(`0${digits.slice(3)}`)
  }
  return variants
}

function provenConnectedEvidenceWhere(): Prisma.CallLogWhereInput {
  return {
    OR: [
      {
        callMode: "human",
        OR: [
          { wasAnswered: true },
          { providerOutcome: "connected" },
        ],
      },
      {
        callMode: "ai",
        conversationOutcome: { in: ["customer_spoke", AI_CONNECTED_PENDING_RESULT] },
      },
    ],
  }
}

function exactPhoneIdentityWhere(phoneE164: string): Prisma.CallLogWhereInput {
  const variants = deterministicCallPhoneVariants(phoneE164)
  return {
    OR: [
      { targetPhoneE164: phoneE164 },
      ...(variants.length > 0
        ? [
            { direction: "outbound", toNumber: { in: variants } },
            { direction: "inbound", fromNumber: { in: variants } },
          ] satisfies Prisma.CallLogWhereInput[]
        : []),
    ],
  }
}

/**
 * Single-target predicate used by claim-time queue checks.
 *
 * Legacy rows predate wasAnswered/providerOutcome. Only a positive-duration,
 * completed human call attached to the exact same lead is accepted as legacy
 * evidence. Legacy raw-phone rows never get that fallback because doing so
 * could suppress a different lead after a weak number match.
 */
export function buildPriorConnectedCallWhere(params: {
  organizationId: string
  leadId: string
  targetPhoneE164: string
}): Prisma.CallLogWhereInput {
  return {
    organizationId: params.organizationId,
    OR: [
      {
        AND: [
          {
            OR: [
              { leadId: params.leadId },
              exactPhoneIdentityWhere(params.targetPhoneE164),
            ],
          },
          provenConnectedEvidenceWhere(),
        ],
      },
      {
        leadId: params.leadId,
        callMode: "human",
        status: "completed",
        duration: { gt: 0 },
      },
    ],
  }
}

function isProvenConnected(row: ConnectedCallHistoryRow): boolean {
  if (row.callMode === "ai") {
    return row.conversationOutcome === "customer_spoke"
      || row.conversationOutcome === AI_CONNECTED_PENDING_RESULT
  }
  return row.callMode === "human"
    && (row.wasAnswered || row.providerOutcome === "connected")
}

function isLegacySameLeadEvidence(row: ConnectedCallHistoryRow): boolean {
  return row.callMode === "human"
    && row.status === "completed"
    && typeof row.duration === "number"
    && row.duration > 0
    && Boolean(row.leadId)
}

/**
 * Batch form for queue preview. The database reads only exact lead ids,
 * canonical identities, and deterministic raw variants, then the result is
 * classified again in memory so a legacy same-lead fallback cannot leak to a
 * duplicate lead that merely shares a phone.
 */
export async function loadPriorConnectedCallHistory(params: {
  db: ConnectedCallHistoryDb
  organizationId: string
  targets: readonly ConnectedCallHistoryTarget[]
}): Promise<ConnectedCallHistory> {
  const connectedLeadIds = new Set<string>()
  const connectedPhoneE164s = new Set<string>()
  if (params.targets.length === 0) return { connectedLeadIds, connectedPhoneE164s }

  const leadIds = [...new Set(params.targets.map((target) => target.leadId.trim()).filter(Boolean))]
  const phoneE164s = [...new Set(
    params.targets
      .map((target) => target.targetPhoneE164.trim())
      .filter((phone) => CANONICAL_E164.test(phone)),
  )]
  const variants = [...new Set(phoneE164s.flatMap(deterministicCallPhoneVariants))]

  const identity: Prisma.CallLogWhereInput[] = []
  if (leadIds.length > 0) identity.push({ leadId: { in: leadIds } })
  if (phoneE164s.length > 0) identity.push({ targetPhoneE164: { in: phoneE164s } })
  if (variants.length > 0) {
    identity.push(
      { direction: "outbound", toNumber: { in: variants } },
      { direction: "inbound", fromNumber: { in: variants } },
    )
  }
  if (identity.length === 0) return { connectedLeadIds, connectedPhoneE164s }

  const rows = await params.db.callLog.findMany({
    where: {
      organizationId: params.organizationId,
      OR: [
        {
          AND: [
            { OR: identity },
            provenConnectedEvidenceWhere(),
          ],
        },
        ...(leadIds.length > 0
          ? [{
              leadId: { in: leadIds },
              callMode: "human",
              status: "completed",
              duration: { gt: 0 },
            } satisfies Prisma.CallLogWhereInput]
          : []),
      ],
    },
    select: {
      leadId: true,
      direction: true,
      fromNumber: true,
      toNumber: true,
      targetPhoneE164: true,
      callMode: true,
      wasAnswered: true,
      providerOutcome: true,
      conversationOutcome: true,
      status: true,
      duration: true,
    },
  })

  const targetLeadIds = new Set(leadIds)
  const targetPhoneE164s = new Set(phoneE164s)
  const phoneByVariant = new Map<string, Set<string>>()
  for (const phoneE164 of phoneE164s) {
    for (const variant of deterministicCallPhoneVariants(phoneE164)) {
      const matches = phoneByVariant.get(variant) ?? new Set<string>()
      matches.add(phoneE164)
      phoneByVariant.set(variant, matches)
    }
  }

  for (const row of rows as ConnectedCallHistoryRow[]) {
    const proven = isProvenConnected(row)
    if (row.leadId && targetLeadIds.has(row.leadId) && (proven || isLegacySameLeadEvidence(row))) {
      connectedLeadIds.add(row.leadId)
    }
    if (!proven) continue

    if (row.targetPhoneE164 && targetPhoneE164s.has(row.targetPhoneE164)) {
      connectedPhoneE164s.add(row.targetPhoneE164)
    }
    const rawExternalNumber = row.direction === "outbound"
      ? row.toNumber
      : row.direction === "inbound"
        ? row.fromNumber
        : null
    if (!rawExternalNumber) continue
    for (const phoneE164 of phoneByVariant.get(rawExternalNumber) ?? []) {
      connectedPhoneE164s.add(phoneE164)
    }
  }

  return { connectedLeadIds, connectedPhoneE164s }
}
