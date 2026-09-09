import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

export const MONITORING_SUBJECT_TYPES = [
  "COMPANY",
  "PERSON",
  "BRAND",
  "PRODUCT",
  "ORGANIZATION",
  "TOPIC",
  "EVENT",
] as const

export const MONITORING_SUBJECT_ALIAS_KINDS = [
  "NAME",
  "TRANSLITERATION",
  "INFLECTION",
  "HANDLE",
  "HASHTAG",
  "DOMAIN",
  "TYPO",
  "CONTEXT",
  "NEGATIVE",
] as const

export const MONITORING_SUBJECT_RELATION_TYPES = [
  "BRAND_OF",
  "PRODUCT_OF",
  "REPRESENTATIVE_OF",
  "COMPETITOR_OF",
  "RELATED_TO",
] as const

export type MonitoringSubjectType = typeof MONITORING_SUBJECT_TYPES[number]
export type MonitoringSubjectAliasKind = typeof MONITORING_SUBJECT_ALIAS_KINDS[number]
export type MonitoringSubjectRelationType = typeof MONITORING_SUBJECT_RELATION_TYPES[number]

export type MonitoringSubjectAliasInput = {
  kind: MonitoringSubjectAliasKind
  value: string
  language?: string | null
  weight?: number
  isNegative?: boolean
  isAmbiguous?: boolean
}

export type SocialReplyIdentityInput = {
  socialAccountId: string
  priority?: number
  languages?: string[]
  signature?: string | null
  allowOwnedReply?: boolean
  allowExternalReply?: boolean
}

export type MonitoringSubjectRelationInput = {
  relatedSubjectId: string
  relationType: MonitoringSubjectRelationType
  weight?: number
}

export type MonitoringSubjectInput = {
  type: MonitoringSubjectType
  name: string
  description?: string | null
  status?: "active" | "paused" | "archived"
  languages?: string[]
  geographies?: string[]
  requiredContext?: string[]
  exclusions?: string[]
  sensitiveCategories?: string[]
  assignedAgentId?: string | null
  replyPolicy?: Record<string, unknown>
  legalPolicy?: Record<string, unknown>
  aliases?: MonitoringSubjectAliasInput[]
  /** @deprecated Sources are managed independently; retained for old clients. */
  sourceIds?: string[]
  replyIdentities?: SocialReplyIdentityInput[]
  relations?: MonitoringSubjectRelationInput[]
}

export function normalizeSubjectTerm(value: string): string {
  return value
    .normalize("NFKC")
    // Locale-neutral casing keeps OCR/ASCII `I` stable (`I` -> `i`) while
    // Unicode lowercasing still preserves Azerbaijani letters such as
    // ə/ğ/ş/ç/ö/ü and an explicitly entered dotless `ı`. Uppercase `İ`
    // lowercases to `i` + COMBINING DOT ABOVE, so remove that canonicalization
    // artifact before matching aliases.
    .toLowerCase()
    .replace(/\u0307/g, "")
    .replace(/^[#@]+/, "")
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueStrings(values: string[] | undefined, max = 80): string[] {
  return Array.from(new Set((values ?? []).map(value => value.trim()).filter(Boolean))).slice(0, max)
}

/**
 * A single bare word matched anywhere on a global platform is weak evidence:
 * "bravo", "araz" (also a river) or "oba" auto-accepting at confidence 1 is
 * how junk reached client feeds (#636). Words up to this length default to
 * needing a second signal; longer single tokens are almost always brand
 * compounds ("arazsupermarket") whose match is genuinely distinctive.
 */
export const AMBIGUOUS_SINGLE_TOKEN_MAX_LENGTH = 8

/**
 * Default ambiguity for an alias when the operator has not decided explicitly.
 * Multi-word phrases stay non-ambiguous by default; an explicit isAmbiguous
 * boolean from the operator or the API always wins over this heuristic.
 *
 * HASHTAG and HANDLE aliases get the same single-token rule as NAME: the
 * matcher treats their prefix as optional ("#?"/"@?"), so a short hashtag
 * alias also matches the bare word in plain text — leaving it non-ambiguous
 * reopened the exact confidence-1 hole this gate closes (#636 review).
 */
const AMBIGUOUS_ALIAS_KINDS = new Set(["NAME", "HASHTAG", "HANDLE"])

export function defaultAliasAmbiguity(kind: string, normalizedValue: string): boolean {
  if (!AMBIGUOUS_ALIAS_KINDS.has(kind)) return false
  if (normalizedValue.includes(" ")) return false
  return normalizedValue.length <= AMBIGUOUS_SINGLE_TOKEN_MAX_LENGTH
}

function normalizedAliases(
  name: string,
  aliases: MonitoringSubjectAliasInput[] | undefined,
  preservedAmbiguity?: ReadonlyMap<string, boolean>,
) {
  const candidates: MonitoringSubjectAliasInput[] = [
    { kind: "NAME", value: name, weight: 1 },
    ...(aliases ?? []),
  ]
  // The operator's explicit decision must survive dedupe even when its row
  // does not: the synthetic primary-name candidate is prepended flagless and
  // dedupe keeps the first row per key, so without this map an explicit flag
  // on an alias equal to the subject's own name was silently discarded
  // (#636 review).
  const explicitAmbiguity = new Map<string, boolean>()
  for (const alias of candidates) {
    if (typeof alias.isAmbiguous !== "boolean") continue
    const normalizedValue = normalizeSubjectTerm(alias.value.trim())
    if (!normalizedValue) continue
    const key = `${alias.isNegative ? "NEGATIVE" : alias.kind}:${normalizedValue}`
    if (!explicitAmbiguity.has(key)) explicitAmbiguity.set(key, alias.isAmbiguous)
  }
  const seen = new Set<string>()
  return candidates.flatMap(alias => {
    const value = alias.value.trim()
    const normalizedValue = normalizeSubjectTerm(value)
    if (!normalizedValue) return []
    const kind = alias.isNegative ? "NEGATIVE" : alias.kind
    const key = `${kind}:${normalizedValue}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      kind,
      value,
      normalizedValue,
      language: alias.language?.trim() || null,
      weight: Math.max(0, Math.min(1, alias.weight ?? 1)),
      isNegative: alias.isNegative === true || kind === "NEGATIVE",
      // Precedence: the operator's explicit choice in this submission, then a
      // stricter stored flag preserved across a flagless re-save (the profile
      // wizard resubmits aliases without flags), then the heuristic default.
      isAmbiguous: explicitAmbiguity.get(key)
        ?? (preservedAmbiguity?.get(key) === true ? true : defaultAliasAmbiguity(kind, normalizedValue)),
    }]
  })
}

function normalizedRelations(relations: MonitoringSubjectRelationInput[] | undefined) {
  const seen = new Set<string>()
  return (relations ?? []).flatMap(relation => {
    const relatedSubjectId = relation.relatedSubjectId.trim()
    const key = `${relatedSubjectId}:${relation.relationType}`
    if (!relatedSubjectId || seen.has(key)) return []
    seen.add(key)
    return [{
      relatedSubjectId,
      relationType: relation.relationType,
      weight: Math.max(0, Math.min(1, relation.weight ?? 0.75)),
    }]
  })
}

async function validateAssignedSocialAgent(organizationId: string, assignedAgentId: string | null | undefined) {
  const id = assignedAgentId?.trim()
  if (!id) return null
  const agent = await prisma.aiAgentConfig.findFirst({
    where: { id, organizationId, agentType: "social", isActive: true },
    select: { id: true },
  })
  if (!agent) throw new Error("Assigned social-monitoring agent is unavailable")
  return agent.id
}

export const monitoringSubjectInclude = {
  aliases: { orderBy: [{ isNegative: "asc" as const }, { weight: "desc" as const }, { value: "asc" as const }] },
  sources: { include: { source: true } },
  replyIdentities: { include: { socialAccount: true }, orderBy: { priority: "asc" as const } },
  outgoingRelations: { include: { relatedSubject: { select: { id: true, name: true, type: true } } } },
} satisfies Prisma.MonitoringSubjectInclude

export async function listMonitoringSubjects(organizationId: string) {
  return prisma.monitoringSubject.findMany({
    where: { organizationId, status: { not: "archived" } },
    include: monitoringSubjectInclude,
    orderBy: [{ status: "asc" }, { name: "asc" }],
  })
}

async function validateSubjectLinks(
  organizationId: string,
  identities: SocialReplyIdentityInput[],
  relations: MonitoringSubjectRelationInput[],
  currentSubjectId?: string,
): Promise<Map<string, string>> {
  if (currentSubjectId && relations.some(relation => relation.relatedSubjectId === currentSubjectId)) {
    throw new Error("A monitoring subject cannot relate to itself")
  }
  const relatedSubjectIds = Array.from(new Set(relations.map(relation => relation.relatedSubjectId)))
  const [accounts, relatedSubjectCount] = await Promise.all([
    identities.length > 0
      ? prisma.socialAccount.findMany({
          where: { organizationId, id: { in: identities.map(item => item.socialAccountId) }, isActive: true },
          select: { id: true, platform: true },
        })
      : Promise.resolve([]),
    relatedSubjectIds.length > 0
      ? prisma.monitoringSubject.count({
          where: { organizationId, id: { in: relatedSubjectIds }, status: { not: "archived" } },
        })
      : Promise.resolve(0),
  ])
  if (accounts.length !== identities.length) throw new Error("One or more reply identities are unavailable")
  if (relatedSubjectCount !== relatedSubjectIds.length) throw new Error("One or more related monitoring subjects are unavailable")
  return new Map<string, string>(accounts.map((account: { id: string; platform: string }) => [account.id, account.platform]))
}

export async function createMonitoringSubject(
  organizationId: string,
  userId: string | undefined,
  input: MonitoringSubjectInput,
) {
  const name = input.name.trim()
  const replyIdentities = input.replyIdentities ?? []
  const relations = normalizedRelations(input.relations)
  const [accountPlatforms, assignedAgentId] = await Promise.all([
    validateSubjectLinks(organizationId, replyIdentities, relations),
    validateAssignedSocialAgent(organizationId, input.assignedAgentId),
  ])
  const aliases = normalizedAliases(name, input.aliases)

  return prisma.monitoringSubject.create({
    data: {
      organizationId,
      type: input.type,
      name,
      description: input.description?.trim() || null,
      status: input.status ?? "active",
      languages: uniqueStrings(input.languages, 20),
      geographies: uniqueStrings(input.geographies, 40),
      requiredContext: uniqueStrings(input.requiredContext),
      exclusions: uniqueStrings(input.exclusions),
      sensitiveCategories: uniqueStrings(input.sensitiveCategories, 40),
      assignedAgentId,
      replyPolicy: (input.replyPolicy ?? {}) as Prisma.InputJsonValue,
      legalPolicy: (input.legalPolicy ?? {}) as Prisma.InputJsonValue,
      createdBy: userId,
      aliases: { create: aliases },
      replyIdentities: {
        create: replyIdentities.map(identity => ({
          organizationId,
          socialAccountId: identity.socialAccountId,
          platform: accountPlatforms.get(identity.socialAccountId)!,
          priority: Math.max(1, Math.min(999, identity.priority ?? 100)),
          languages: uniqueStrings(identity.languages, 20),
          signature: identity.signature?.trim() || null,
          allowOwnedReply: identity.allowOwnedReply ?? true,
          // Merely linking an account must never grant external sending.
          allowExternalReply: identity.allowExternalReply === true,
        })),
      },
      outgoingRelations: {
        create: relations.map(relation => ({ organizationId, ...relation })),
      },
    },
    include: monitoringSubjectInclude,
  })
}

/**
 * Claims the identity row for a new profile under an organization-scoped
 * PostgreSQL advisory lock. The row starts paused: if the process dies before
 * the profile's collection plan is committed, it can never pretend to be an
 * active monitoring. A concurrent request with the same normalized name sees
 * and reuses this row after the lock is released.
 */
export async function claimMonitoringSubjectIdentity(
  organizationId: string,
  userId: string | undefined,
  input: Pick<MonitoringSubjectInput, "type" | "name" | "aliases">,
): Promise<{ subjectId: string; created: boolean }> {
  const name = input.name.trim()
  if (!name) throw new Error("Monitoring subject name is required")
  const normalizedName = normalizeSubjectTerm(name)

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`monitoring-subject-name:${organizationId}:${normalizedName}`}, 0))`
    const candidates = await tx.monitoringSubject.findMany({
      where: { organizationId, status: { not: "deleted" } },
      select: { id: true, name: true },
    })
    const existing = candidates.find((candidate: { id: string; name: string }) => normalizeSubjectTerm(candidate.name) === normalizedName)
    if (existing) return { subjectId: existing.id, created: false }

    const created = await tx.monitoringSubject.create({
      data: {
        organizationId,
        type: input.type,
        name,
        status: "paused",
        createdBy: userId,
        aliases: { create: normalizedAliases(name, input.aliases) },
      },
      select: { id: true },
    })
    return { subjectId: created.id, created: true }
  })
}

export async function updateMonitoringSubject(
  organizationId: string,
  id: string,
  input: Partial<MonitoringSubjectInput>,
) {
  const existing = await prisma.monitoringSubject.findFirst({
    where: { organizationId, id },
    select: { id: true, name: true, aliases: true },
  })
  if (!existing) throw new Error("Monitoring subject not found")
  const name = input.name?.trim() || existing.name
  const replyIdentities = input.replyIdentities === undefined ? null : input.replyIdentities
  const relations = input.relations === undefined ? null : normalizedRelations(input.relations)
  const accountPlatforms = await validateSubjectLinks(
    organizationId,
    replyIdentities ?? [],
    relations ?? [],
    id,
  )
  const assignedAgentId = input.assignedAgentId === undefined
    ? undefined
    : await validateAssignedSocialAgent(organizationId, input.assignedAgentId)

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.monitoringSubject.update({
      where: { organizationId_id: { organizationId, id } },
      data: {
        ...(input.type ? { type: input.type } : {}),
        ...(input.name !== undefined ? { name } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.languages !== undefined ? { languages: uniqueStrings(input.languages, 20) } : {}),
        ...(input.geographies !== undefined ? { geographies: uniqueStrings(input.geographies, 40) } : {}),
        ...(input.requiredContext !== undefined ? { requiredContext: uniqueStrings(input.requiredContext) } : {}),
        ...(input.exclusions !== undefined ? { exclusions: uniqueStrings(input.exclusions) } : {}),
        ...(input.sensitiveCategories !== undefined ? { sensitiveCategories: uniqueStrings(input.sensitiveCategories, 40) } : {}),
        ...(assignedAgentId !== undefined ? { assignedAgentId } : {}),
        ...(input.replyPolicy !== undefined ? { replyPolicy: input.replyPolicy as Prisma.InputJsonValue } : {}),
        ...(input.legalPolicy !== undefined ? { legalPolicy: input.legalPolicy as Prisma.InputJsonValue } : {}),
        ...((input.aliases !== undefined || input.name !== undefined) ? { aliasesVersion: { increment: 1 } } : {}),
      },
    })
    if (input.aliases !== undefined || input.name !== undefined) {
      // A stored ambiguous mark is an operator/policy decision. Callers that
      // resubmit aliases without flags (the profile wizard strips them) must
      // not silently downgrade it back to the heuristic; only an explicit
      // isAmbiguous in the incoming payload may lift it.
      const preservedAmbiguity = new Map<string, boolean>(existing.aliases
        .filter((alias: Prisma.MonitoringSubjectAliasGetPayload<Record<string, never>>) => alias.isAmbiguous === true)
        .map((alias: Prisma.MonitoringSubjectAliasGetPayload<Record<string, never>>) => [`${alias.kind}:${alias.normalizedValue}`, true]))
      await tx.monitoringSubjectAlias.deleteMany({ where: { organizationId, subjectId: id } })
      const aliasesForReplacement = input.aliases ?? existing.aliases
        .filter((alias: Prisma.MonitoringSubjectAliasGetPayload<Record<string, never>>) => !(alias.kind === "NAME" && alias.normalizedValue === normalizeSubjectTerm(existing.name)))
        .map((alias: Prisma.MonitoringSubjectAliasGetPayload<Record<string, never>>) => ({
          kind: alias.kind as MonitoringSubjectAliasKind,
          value: alias.value,
          language: alias.language,
          weight: alias.weight,
          isNegative: alias.isNegative,
          isAmbiguous: alias.isAmbiguous,
        }))
      await tx.monitoringSubjectAlias.createMany({
        data: normalizedAliases(name, aliasesForReplacement, preservedAmbiguity).map(alias => ({ organizationId, subjectId: id, ...alias })),
      })
    }
    if (replyIdentities) {
      await tx.socialReplyIdentity.deleteMany({ where: { organizationId, subjectId: id } })
      if (replyIdentities.length > 0) await tx.socialReplyIdentity.createMany({
        data: replyIdentities.map(identity => ({
          organizationId,
          subjectId: id,
          socialAccountId: identity.socialAccountId,
          platform: accountPlatforms.get(identity.socialAccountId)!,
          priority: Math.max(1, Math.min(999, identity.priority ?? 100)),
          languages: uniqueStrings(identity.languages, 20),
          signature: identity.signature?.trim() || null,
          allowOwnedReply: identity.allowOwnedReply ?? true,
          allowExternalReply: identity.allowExternalReply === true,
        })),
      })
    }
    if (relations) {
      await tx.monitoringSubjectRelation.deleteMany({ where: { organizationId, subjectId: id } })
      if (relations.length > 0) await tx.monitoringSubjectRelation.createMany({
        data: relations.map(relation => ({ organizationId, subjectId: id, ...relation })),
      })
    }
  })

  return prisma.monitoringSubject.findUniqueOrThrow({
    where: { organizationId_id: { organizationId, id } },
    include: monitoringSubjectInclude,
  })
}

export async function archiveMonitoringSubject(organizationId: string, id: string) {
  const result = await prisma.monitoringSubject.updateMany({
    where: { organizationId, id },
    data: { status: "archived" },
  })
  if (result.count !== 1) throw new Error("Monitoring subject not found")
}
