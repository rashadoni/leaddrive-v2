import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import {
  ContactDictionaryEntriesSchema,
  contactDictionaryHash,
  contactDictionarySignatureIsCoherent,
  type ContactDictionaryEntry,
} from "@/lib/mtm/contact-dictionary"
import type { ContactDictionaryAssignmentSetSchema } from "@/lib/mtm-validators"
import type { z } from "zod"

export const CONTACT_MASTER_DICTIONARY_KINDS = [
  "PSYCHOTYPE",
  "PRODUCT_CATEGORY",
  "BRAND_CATEGORY",
] as const

export type ContactMasterDictionaryKind = typeof CONTACT_MASTER_DICTIONARY_KINDS[number]
export type ContactDictionaryAssignmentSet = z.infer<typeof ContactDictionaryAssignmentSetSchema>

type AssignmentRow = {
  id: string
  dictionaryId: string
  kind: string
  entryCode: string
  effectiveFrom: Date
  effectiveTo: Date | null
  updatedAt: Date
}

type DictionaryRow = {
  id: string
  organizationId: string
  kind: string
  status: string
  entries: Prisma.JsonValue
  entriesHash: string
  approvalReference: string | null
  signedByUserId: string | null
  signedAt: Date | null
  activatedAt: Date | null
  retiredAt: Date | null
}

type AssignmentClient = Pick<Prisma.TransactionClient,
  "mtmContactDictionaryAssignment" | "mtmContactDictionary" | "$queryRaw"
>

export class ContactDictionaryAssignmentConflict extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message)
  }
}

export function contactDictionaryAssignmentStateHash(rows: AssignmentRow[]): string {
  const canonical = rows
    .filter((row) => row.effectiveTo === null)
    .map((row) => ({
      id: row.id,
      dictionaryId: row.dictionaryId,
      kind: row.kind,
      entryCode: row.entryCode,
      effectiveFrom: row.effectiveFrom.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
    .sort((left, right) => (
      left.kind.localeCompare(right.kind)
      || left.entryCode.localeCompare(right.entryCode)
      || left.id.localeCompare(right.id)
    ))
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
}

export function verifiedContactDictionaryEntries(
  dictionary: DictionaryRow,
  options: { requireActive?: boolean } = {},
): ContactDictionaryEntry[] | null {
  if (options.requireActive && dictionary.status !== "ACTIVE") return null
  if (!options.requireActive && !["ACTIVE", "RETIRED"].includes(dictionary.status)) return null
  if (!contactDictionarySignatureIsCoherent(dictionary)) return null
  const parsed = ContactDictionaryEntriesSchema.safeParse(dictionary.entries)
  if (!parsed.success || contactDictionaryHash(parsed.data) !== dictionary.entriesHash) return null
  return parsed.data
}

function desiredRows(input: ContactDictionaryAssignmentSet): Array<{
  kind: ContactMasterDictionaryKind
  dictionaryId: string
  entryCode: string
}> {
  return [
    ...(input.psychotype ? [{
      kind: "PSYCHOTYPE" as const,
      dictionaryId: input.psychotype.dictionaryId,
      entryCode: input.psychotype.code,
    }] : []),
    ...(input.productCategories?.codes.map((entryCode) => ({
      kind: "PRODUCT_CATEGORY" as const,
      dictionaryId: input.productCategories!.dictionaryId,
      entryCode,
    })) ?? []),
    ...(input.brandCategories?.codes.map((entryCode) => ({
      kind: "BRAND_CATEGORY" as const,
      dictionaryId: input.brandCategories!.dictionaryId,
      entryCode,
    })) ?? []),
  ]
}

export async function validateContactDictionaryAssignmentSet(
  client: Pick<Prisma.TransactionClient, "mtmContactDictionary">,
  organizationId: string,
  input: ContactDictionaryAssignmentSet,
): Promise<Map<string, { dictionary: DictionaryRow; entries: ContactDictionaryEntry[] }>> {
  const desired = desiredRows(input)
  const dictionaryIds = [...new Set(desired.map((row) => row.dictionaryId))]
  if (dictionaryIds.length === 0) return new Map()

  const dictionaries = await client.mtmContactDictionary.findMany({
    where: { id: { in: dictionaryIds }, organizationId, status: "ACTIVE" },
  }) as unknown as DictionaryRow[]
  const byId = new Map<string, { dictionary: DictionaryRow; entries: ContactDictionaryEntry[] }>()
  for (const dictionary of dictionaries) {
    const entries = verifiedContactDictionaryEntries(dictionary, { requireActive: true })
    if (entries) byId.set(dictionary.id, { dictionary, entries })
  }

  for (const row of desired) {
    const governed = byId.get(row.dictionaryId)
    if (!governed || governed.dictionary.kind !== row.kind) {
      throw new ContactDictionaryAssignmentConflict(
        "MTM_CONTACT_DICTIONARY_INVALID",
        `No signed active ${row.kind} dictionary is available`,
        422,
      )
    }
    if (!governed.entries.some((entry) => entry.code === row.entryCode)) {
      throw new ContactDictionaryAssignmentConflict(
        "MTM_CONTACT_DICTIONARY_ENTRY_INVALID",
        `Entry ${row.entryCode} is not part of the signed dictionary`,
        422,
      )
    }
  }
  return byId
}

export async function readContactDictionaryAssignmentState(
  client: Pick<Prisma.TransactionClient, "mtmContactDictionaryAssignment">,
  organizationId: string,
  contactId: string,
): Promise<{ rows: AssignmentRow[]; hash: string }> {
  const rows = await client.mtmContactDictionaryAssignment.findMany({
    where: { organizationId, contactId, effectiveTo: null },
    orderBy: [{ kind: "asc" }, { entryCode: "asc" }, { effectiveFrom: "asc" }],
  }) as unknown as AssignmentRow[]
  return { rows, hash: contactDictionaryAssignmentStateHash(rows) }
}

export async function applyContactDictionaryAssignmentSet(
  client: AssignmentClient,
  args: {
    organizationId: string
    contactId: string
    input: ContactDictionaryAssignmentSet
    source: string
    createdByUserId?: string | null
    requestedByAgentId?: string | null
    approvedByUserId?: string | null
    sourceRequestId?: string | null
    now?: Date
  },
): Promise<{ ended: number; created: number; stateHash: string }> {
  const now = args.now ?? new Date()
  await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mtm-contact-dictionary-assignment:${args.organizationId}:${args.contactId}`}, 0))`
  const current = await readContactDictionaryAssignmentState(client, args.organizationId, args.contactId)
  if (current.hash !== args.input.expectedStateHash) {
    throw new ContactDictionaryAssignmentConflict(
      "MTM_CONTACT_DICTIONARY_ASSIGNMENT_CONFLICT",
      "Contact categories changed since the form was opened",
    )
  }
  await validateContactDictionaryAssignmentSet(client, args.organizationId, args.input)

  const desired = desiredRows(args.input)
  const desiredKeys = new Set(desired.map((row) => `${row.kind}:${row.dictionaryId}:${row.entryCode}`))
  const retainedKeys = new Set(current.rows
    .map((row) => `${row.kind}:${row.dictionaryId}:${row.entryCode}`)
    .filter((key) => desiredKeys.has(key)))
  const toEnd = current.rows.filter((row) => !desiredKeys.has(`${row.kind}:${row.dictionaryId}:${row.entryCode}`))
  const toCreate = desired.filter((row) => !retainedKeys.has(`${row.kind}:${row.dictionaryId}:${row.entryCode}`))
  const effectiveAt = new Date(Math.max(
    now.getTime(),
    ...toEnd.map((row) => row.effectiveFrom.getTime() + 1),
  ))

  if (toEnd.length > 0) {
    await client.mtmContactDictionaryAssignment.updateMany({
      where: { organizationId: args.organizationId, id: { in: toEnd.map((row) => row.id) }, effectiveTo: null },
      data: { effectiveTo: effectiveAt },
    })
  }
  if (toCreate.length > 0) {
    await client.mtmContactDictionaryAssignment.createMany({
      data: toCreate.map((row) => ({
        organizationId: args.organizationId,
        contactId: args.contactId,
        dictionaryId: row.dictionaryId,
        kind: row.kind,
        entryCode: row.entryCode,
        effectiveFrom: effectiveAt,
        source: args.source,
        createdByUserId: args.createdByUserId ?? null,
        requestedByAgentId: args.requestedByAgentId ?? null,
        approvedByUserId: args.approvedByUserId ?? null,
        sourceRequestId: args.sourceRequestId ?? null,
      })),
    })
  }

  const after = await readContactDictionaryAssignmentState(client, args.organizationId, args.contactId)
  return { ended: toEnd.length, created: toCreate.length, stateHash: after.hash }
}
