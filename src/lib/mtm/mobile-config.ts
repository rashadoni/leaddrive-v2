import type { Prisma } from "@prisma/client"

export type MobileConfigSetting = {
  key: string
  value: Prisma.JsonValue
  updatedAt: Date
}

export type MobileConfigPayload = {
  version: string
  dictionaries: Record<string, Prisma.JsonValue>
  formulas: Record<string, Prisma.JsonValue>
}

export type ActiveContactDictionary = {
  id: string
  kind: "PSYCHOTYPE" | "PRODUCT_CATEGORY" | "BRAND_CATEGORY" | "TASK_GROUP"
  version: number
  nameRu: string
  nameAz: string
  nameEn: string
  entries: Prisma.JsonValue
  entriesHash: string
  approvalReference: string | null
  sourceSystem: string
  sourceReference: string | null
  sourceObservedAt: Date
  effectiveFrom: Date
  signedAt: Date | null
  updatedAt: Date
}

const CONTACT_DICTIONARY_KEYS: Record<ActiveContactDictionary["kind"], string> = {
  PSYCHOTYPE: "psychotype",
  PRODUCT_CATEGORY: "productCategory",
  BRAND_CATEGORY: "brandCategory",
  TASK_GROUP: "taskGroup",
}

/**
 * Transitional formula/legacy-dictionary reader plus the governed contact
 * dictionary projection. Dedicated signed contact dictionaries override a
 * same-named legacy setting; arbitrary organization settings never leak into
 * mobile config.
 */
export function buildMobileConfig(
  rows: MobileConfigSetting[],
  contactDictionaries: ActiveContactDictionary[] = [],
): MobileConfigPayload {
  const dictionaries: Record<string, Prisma.JsonValue> = {}
  const formulas: Record<string, Prisma.JsonValue> = {}
  let latest = 0
  for (const row of rows) {
    if (row.key.startsWith("dictionary:")) {
      latest = Math.max(latest, row.updatedAt.getTime())
      dictionaries[row.key.slice("dictionary:".length)] = row.value
    }
    if (row.key.startsWith("formula:")) {
      latest = Math.max(latest, row.updatedAt.getTime())
      formulas[row.key.slice("formula:".length)] = row.value
    }
  }
  for (const dictionary of contactDictionaries) {
    latest = Math.max(latest, dictionary.updatedAt.getTime())
    dictionaries[CONTACT_DICTIONARY_KEYS[dictionary.kind]] = {
      id: dictionary.id,
      kind: dictionary.kind,
      version: dictionary.version,
      names: { ru: dictionary.nameRu, az: dictionary.nameAz, en: dictionary.nameEn },
      entries: dictionary.entries,
      entriesHash: dictionary.entriesHash,
      approvalReference: dictionary.approvalReference,
      sourceSystem: dictionary.sourceSystem,
      sourceReference: dictionary.sourceReference,
      sourceObservedAt: dictionary.sourceObservedAt.toISOString(),
      effectiveFrom: dictionary.effectiveFrom.toISOString().slice(0, 10),
      signedAt: dictionary.signedAt?.toISOString() ?? null,
    }
  }
  return { version: latest === 0 ? "0" : new Date(latest).toISOString(), dictionaries, formulas }
}
