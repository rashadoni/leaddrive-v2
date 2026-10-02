import type { Prisma } from "@prisma/client"

/**
 * The typed fields of the «Клиенты» and «Учреждения» filters (owner
 * 2026-10-02: a field per thing you look for — employee, specialty, client
 * name, address, district, institution — instead of one box plus a row of
 * dropdowns nobody could read).
 *
 * A field is matched word by word: «Nizami 76» finds «Nizami küçəsi 76», and
 * «Məmmədova Aysel» finds «Aysel Məmmədova». Every word must be found; which
 * column it is found in depends on the field.
 */
export const MTM_LIST_FILTER_WORD_LIMIT = 6

export function listFilterWords(value: string | null | undefined): string[] {
  const words = (value ?? "").split(/[\s,;]+/).map((word) => word.trim()).filter(Boolean)
  return [...new Set(words)].slice(0, MTM_LIST_FILTER_WORD_LIMIT)
}

const has = (word: string) => ({ contains: word, mode: "insensitive" as const })

/** Institution name or its code. */
export function organizationNameFilter(value: string | null | undefined): Prisma.MtmCustomerWhereInput[] {
  return listFilterWords(value).map((word) => ({
    OR: [{ name: has(word) }, { code: has(word) }],
  }))
}

/**
 * Address as a person types it — street, and often the city or district with
 * it — so the city and district columns count too.
 */
export function organizationAddressFilter(value: string | null | undefined): Prisma.MtmCustomerWhereInput[] {
  return listFilterWords(value).map((word) => ({
    OR: [{ address: has(word) }, { city: has(word) }, { district: has(word) }],
  }))
}

/**
 * City or district. Tenants fill `city` and `district` by hand; the reference
 * geography columns (region … city district) are filled only by an import, and
 * both mean the same thing to the person typing «Yasamal».
 */
export function organizationAreaFilter(value: string | null | undefined): Prisma.MtmCustomerWhereInput[] {
  return listFilterWords(value).map((word) => ({
    OR: [
      { city: has(word) },
      { district: has(word) },
      { region: has(word) },
      { administrativeDistrict: has(word) },
      { locality: has(word) },
      { cityDistrict: has(word) },
    ],
  }))
}

export interface ContactFieldFilterInput {
  name?: string | null
  address?: string | null
  area?: string | null
  workplace?: string | null
  specialties?: readonly string[]
  /** An exact institution (the list opened from an institution card). */
  customerId?: string | null
  /** Exact-value filters on the institution (region, kind, type …). */
  workplaceCustomer?: Prisma.MtmCustomerWhereInput
}

/**
 * Conditions to AND into the client list. Everything that describes the place
 * of work has to hold for ONE current workplace: a doctor who works in two
 * institutions is not found by the name of one and the district of the other.
 * A client's own address counts as well when only address or district is
 * asked — some clients are kept with a home address and no institution.
 */
export function contactFieldFilters(input: ContactFieldFilterInput): Prisma.MtmContactWhereInput[] {
  const and: Prisma.MtmContactWhereInput[] = []

  for (const word of listFilterWords(input.name)) {
    and.push({ OR: [{ displayName: has(word) }, { externalCode: has(word) }] })
  }

  const specialties = [...new Set((input.specialties ?? []).map((value) => value.trim()).filter(Boolean))]
  if (specialties.length > 0) {
    and.push({
      OR: specialties.flatMap((specialty) => [
        { specialtyName: { equals: specialty, mode: "insensitive" as const } },
        // The code is what the single-choice filter matched before this one.
        { specialtyCode: { equals: specialty, mode: "insensitive" as const } },
      ]),
    })
  }

  const exact = input.workplaceCustomer ?? {}
  const hasExact = Object.keys(exact).length > 0
  const workplaceName = organizationNameFilter(input.workplace)
  const address = organizationAddressFilter(input.address)
  const area = organizationAreaFilter(input.area)
  const customerAnd = [...workplaceName, ...address, ...area]
  if (!input.customerId && !hasExact && customerAnd.length === 0) return and

  const atWorkplace: Prisma.MtmContactWhereInput = {
    workplaces: {
      some: {
        ...(input.customerId ? { customerId: input.customerId } : {}),
        deletedAt: null,
        endedOn: null,
        ...(hasExact || customerAnd.length > 0
          ? { customer: { ...exact, ...(customerAnd.length > 0 ? { AND: customerAnd } : {}) } }
          : {}),
      },
    },
  }
  const placeOnly = Boolean(input.customerId) || hasExact || workplaceName.length > 0
  if (placeOnly) {
    and.push(atWorkplace)
    return and
  }
  const ownAddress: Prisma.MtmContactWhereInput[] = [
    ...listFilterWords(input.address).map((word) => ({
      OR: [
        { addressStreet: has(word) },
        { addressLocality: has(word) },
        { addressDistrict: has(word) },
      ],
    })),
    ...listFilterWords(input.area).map((word) => ({
      OR: [
        { addressLocality: has(word) },
        { addressDistrict: has(word) },
        { addressRegion: has(word) },
      ],
    })),
  ]
  and.push({ OR: [atWorkplace, { AND: ownAddress }] })
  return and
}
