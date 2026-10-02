import type { Prisma } from "@prisma/client"
import { z } from "zod"
import {
  ContactDictionaryEntriesSchema,
  type ContactDictionaryEntry,
} from "@/lib/mtm/contact-dictionary"
import {
  CONTACT_CATEGORY_LIMITS,
  DEFAULT_CONTACT_CATEGORIES,
  isLegacyContactType,
} from "@/lib/mtm/contact-category-editor"

/**
 * Server half of the client-category settings. The simple editor in MTM
 * settings saves through here: one call writes a new signed CLIENT_TYPE
 * dictionary version and retires the previous one, so the administrator never
 * meets drafts, version numbers or approval references — while everything that
 * already reads the signed dictionary (contact form, contact card, mobile
 * sync) keeps working unchanged.
 */

export const CONTACT_CATEGORY_DICTIONARY_NAMES = {
  nameRu: "Категории клиентов",
  nameAz: "Müştəri kateqoriyaları",
  nameEn: "Client categories",
} as const

export const ContactCategoriesSaveSchema = z.object({
  /** The dictionary the editor was opened on; null when the tenant had none. */
  expectedDictionaryId: z.string().trim().min(1).max(64).nullable(),
  categories: ContactDictionaryEntriesSchema.refine(
    (entries) => entries.length <= CONTACT_CATEGORY_LIMITS.categories,
    `At most ${CONTACT_CATEGORY_LIMITS.categories} categories are allowed`,
  ),
}).strict()

type UsageClient = Pick<Prisma.TransactionClient, "mtmContact" | "mtmContactDictionaryAssignment">

const CURRENT_CLIENT_TYPE = { kind: "CLIENT_TYPE" as const, effectiveTo: null }

/**
 * How many live contacts sit in each category. A contact counts under its
 * assigned category; one that was never assigned counts under its built-in
 * type, which is where the list and the card show it.
 */
export async function readContactCategoryUsage(
  client: UsageClient,
  organizationId: string,
): Promise<Record<string, number>> {
  const [assigned, unassigned] = await Promise.all([
    client.mtmContactDictionaryAssignment.groupBy({
      by: ["entryCode"],
      where: { organizationId, ...CURRENT_CLIENT_TYPE, contact: { deletedAt: null } },
      _count: { _all: true },
    }),
    client.mtmContact.groupBy({
      by: ["type"],
      where: { organizationId, deletedAt: null, dictionaryAssignments: { none: CURRENT_CLIENT_TYPE } },
      _count: { _all: true },
    }),
  ])
  const usage: Record<string, number> = {}
  for (const row of assigned as Array<{ entryCode: string; _count: { _all: number } }>) {
    usage[row.entryCode] = (usage[row.entryCode] ?? 0) + row._count._all
  }
  for (const row of unassigned as Array<{ type: string; _count: { _all: number } }>) {
    usage[row.type] = (usage[row.type] ?? 0) + row._count._all
  }
  return usage
}

/**
 * Categories that would disappear while contacts still sit in them. Removing
 * one would leave those contacts showing a category nobody can pick any more,
 * so the save is refused until they are moved.
 */
export function contactCategoryRemovalsInUse(
  previous: ReadonlyArray<{ code: string }>,
  next: ReadonlyArray<{ code: string }>,
  usage: Record<string, number>,
): Array<{ code: string; contacts: number }> {
  const kept = new Set(next.map((entry) => entry.code))
  return previous
    .filter((entry) => !kept.has(entry.code) && (usage[entry.code] ?? 0) > 0)
    .map((entry) => ({ code: entry.code, contacts: usage[entry.code] }))
}

/** The categories a tenant effectively has: its active dictionary, else the built-in three. */
export function contactCategoriesOrDefault(entries: ContactDictionaryEntry[] | null): ContactDictionaryEntry[] {
  if (entries) return entries
  return DEFAULT_CONTACT_CATEGORIES.map((category) => ({
    code: category.code,
    order: category.order,
    labels: { ...category.labels },
    fields: [],
  }))
}

export function parseStoredContactCategories(entries: Prisma.JsonValue): ContactDictionaryEntry[] | null {
  const parsed = ContactDictionaryEntriesSchema.safeParse(entries)
  return parsed.success ? parsed.data : null
}

/**
 * The `type` filter of the contact list, widened from the three built-in
 * types to any category code. A built-in code also matches contacts that were
 * never assigned a category and carry that type — so `type=DOCTOR` returns
 * exactly what it returned before categories existed.
 */
export function contactCategoryWhere(code: string | null): Prisma.MtmContactWhereInput | null {
  if (!code || !/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(code)) return null
  return {
    OR: [
      { dictionaryAssignments: { some: { ...CURRENT_CLIENT_TYPE, entryCode: code } } },
      ...(isLegacyContactType(code)
        ? [{ type: code, dictionaryAssignments: { none: CURRENT_CLIENT_TYPE } }]
        : []),
    ],
  }
}
