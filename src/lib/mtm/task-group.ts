import type { PrismaClient } from "@prisma/client"

import {
  ContactDictionaryEntriesSchema,
  contactDictionaryHash,
  contactDictionarySignatureIsCoherent,
  type ContactDictionaryEntry,
} from "@/lib/mtm/contact-dictionary"

type TaskGroupDictionaryClient = {
  mtmContactDictionary: PrismaClient["mtmContactDictionary"]
}

export type MtmTaskGroupOption = ContactDictionaryEntry & {
  dictionaryId: string
  dictionaryVersion: number
}

export type MtmTaskGroupCatalog = {
  dictionaryId: string
  dictionaryVersion: number
  entries: MtmTaskGroupOption[]
}

type TaskGroupDictionaryRecord = {
  id: string
  version: number
  status: string
  entries: unknown
  entriesHash: string
  approvalReference: string | null
  signedByUserId: string | null
  signedAt: Date | null
  activatedAt: Date | null
  retiredAt: Date | null
}

export class MtmTaskGroupError extends Error {
  constructor(public readonly code: "MTM_TASK_GROUP_CATALOG_UNAVAILABLE" | "MTM_TASK_GROUP_NOT_FOUND") {
    super(code)
  }
}

export function parseMtmTaskGroupCatalog(
  dictionary: TaskGroupDictionaryRecord | null | undefined,
  { requireActive = true }: { requireActive?: boolean } = {},
): MtmTaskGroupCatalog | null {
  if (!dictionary || (requireActive && dictionary.status !== "ACTIVE")) return null
  if (!contactDictionarySignatureIsCoherent(dictionary)) return null
  const parsed = ContactDictionaryEntriesSchema.safeParse(dictionary.entries)
  if (!parsed.success || contactDictionaryHash(parsed.data) !== dictionary.entriesHash) return null
  return {
    dictionaryId: dictionary.id,
    dictionaryVersion: dictionary.version,
    entries: [...parsed.data]
      .sort((left, right) => left.order - right.order || left.code.localeCompare(right.code))
      .map((entry) => ({
        ...entry,
        dictionaryId: dictionary.id,
        dictionaryVersion: dictionary.version,
      })),
  }
}

export async function activeMtmTaskGroupCatalog(
  client: TaskGroupDictionaryClient,
  organizationId: string,
  at = new Date(),
): Promise<MtmTaskGroupCatalog | null> {
  const dictionaries = await client.mtmContactDictionary.findMany({
    where: {
      organizationId,
      kind: "TASK_GROUP",
      status: "ACTIVE",
      effectiveFrom: { lte: at },
    },
    orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
    take: 5,
    select: {
      id: true,
      version: true,
      status: true,
      entries: true,
      entriesHash: true,
      approvalReference: true,
      signedByUserId: true,
      signedAt: true,
      activatedAt: true,
      retiredAt: true,
    },
  })
  for (const dictionary of dictionaries) {
    const catalog = parseMtmTaskGroupCatalog(dictionary)
    if (catalog) return catalog
  }
  return null
}

export async function resolveMtmTaskGroupSelection(
  client: TaskGroupDictionaryClient,
  organizationId: string,
  code: string | null | undefined,
): Promise<MtmTaskGroupOption | null> {
  if (!code) return null
  const catalog = await activeMtmTaskGroupCatalog(client, organizationId)
  if (!catalog) throw new MtmTaskGroupError("MTM_TASK_GROUP_CATALOG_UNAVAILABLE")
  const entry = catalog.entries.find((candidate) => candidate.code === code)
  if (!entry) throw new MtmTaskGroupError("MTM_TASK_GROUP_NOT_FOUND")
  return entry
}

export function storedMtmTaskGroup(
  dictionary: TaskGroupDictionaryRecord | null | undefined,
  code: string | null | undefined,
): MtmTaskGroupOption | null {
  if (!code) return null
  return parseMtmTaskGroupCatalog(dictionary, { requireActive: false })
    ?.entries.find((entry) => entry.code === code) ?? null
}
