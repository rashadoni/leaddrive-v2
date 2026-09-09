import type { Prisma } from "@prisma/client"
import {
  MONITORING_IDENTITY_RELATION_TYPES,
  monitoringSourceCanonicalIdentityKeys,
  monitoringSourceIdentityRole,
  monitoringSourcesShareCanonicalIdentity,
  type MonitoringSourceCanonicalIdentityInput,
  type MonitoringSourceSubjectRelation,
} from "@/lib/social/monitoring-source-identity"
import {
  mergeMonitoringAuthorIdentities,
  monitoringAuthorIdentity,
  monitoringSourceMatchesOwnedIdentity,
  type MonitoringAuthorIdentity,
} from "@/lib/social/mention-author-scope"

export const OFFICIAL_IDENTITY_NOT_COLLECTABLE = "official_identity_not_collectable"

export type MonitoringIdentitySource = MonitoringSourceCanonicalIdentityInput & {
  id: string
  ownership?: string | null
  subjectSources?: MonitoringSourceSubjectRelation[] | null
}

type MonitoringIdentityDbClient = Pick<Prisma.TransactionClient, "monitoringSource"> & {
  monitoringSubject?: Prisma.TransactionClient["monitoringSubject"]
}

const identitySourceSelect = {
  id: true,
  platform: true,
  sourceType: true,
  url: true,
  handle: true,
  query: true,
  ownership: true,
  subjectSources: {
    select: { relationType: true },
  },
} satisfies Prisma.MonitoringSourceSelect

const monitoringIdentitySubjectSelect = {
  name: true,
  aliases: {
    select: {
      kind: true,
      value: true,
    },
  },
  sources: {
    where: {
      OR: [
        { relationType: { in: Array.from(MONITORING_IDENTITY_RELATION_TYPES) } },
        { source: { ownership: "owned" } },
      ],
    },
    select: {
      source: {
        select: {
          id: true,
          platform: true,
          sourceType: true,
          handle: true,
          url: true,
          query: true,
        },
      },
    },
  },
} satisfies Prisma.MonitoringSubjectSelect

const EMPTY_MONITORING_AUTHOR_IDENTITY: MonitoringAuthorIdentity = {
  authorNames: [],
  sourceIds: [],
  webHosts: [],
  profileUrls: [],
}

function isProtectedIdentitySource(source: MonitoringIdentitySource): boolean {
  return source.ownership?.trim().toLowerCase() === "owned"
    || monitoringSourceIdentityRole(source.subjectSources) !== "external"
}

/**
 * Finds an existing official/owned physical identity hidden behind a different
 * URL spelling, protocol, mobile host, tracking query, or @handle form.
 */
export async function findProtectedMonitoringIdentityCollision(input: {
  organizationId: string
  source: MonitoringSourceCanonicalIdentityInput
  excludeSourceId?: string
  db: MonitoringIdentityDbClient
}): Promise<MonitoringIdentitySource | null> {
  if (monitoringSourceCanonicalIdentityKeys(input.source).length === 0) return null

  const protectedSources = await input.db.monitoringSource.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.excludeSourceId ? { id: { not: input.excludeSourceId } } : {}),
      OR: [
        { ownership: "owned" },
        {
          subjectSources: {
            some: {
              relationType: { in: Array.from(MONITORING_IDENTITY_RELATION_TYPES) },
            },
          },
        },
      ],
    },
    select: identitySourceSelect,
  })

  return protectedSources
    .filter(isProtectedIdentitySource)
    .find(source => monitoringSourcesShareCanonicalIdentity(input.source, source)) ?? null
}

export class MonitoringSourceIdentityBlockedError extends Error {
  readonly code = OFFICIAL_IDENTITY_NOT_COLLECTABLE

  constructor() {
    super(OFFICIAL_IDENTITY_NOT_COLLECTABLE)
    this.name = "MonitoringSourceIdentityBlockedError"
  }
}

/**
 * Final dispatch-boundary guard. Re-read current relations after acquiring the
 * run lease, and also reject legacy duplicate rows that canonically point at a
 * separately protected official/owned source.
 */
export async function assertMonitoringSourceIdentityCollectable(input: {
  organizationId: string
  source: MonitoringIdentitySource
  db: MonitoringIdentityDbClient
}): Promise<MonitoringAuthorIdentity> {
  const sources = await input.db.monitoringSource.findMany({
    where: {
      organizationId: input.organizationId,
      OR: [
        { id: input.source.id },
        { ownership: "owned" },
        {
          subjectSources: {
            some: {
              relationType: { in: Array.from(MONITORING_IDENTITY_RELATION_TYPES) },
            },
          },
        },
      ],
    },
    select: identitySourceSelect,
  })
  const current = sources.find(source => source.id === input.source.id)

  if (!current || isProtectedIdentitySource(current)) {
    throw new MonitoringSourceIdentityBlockedError()
  }

  const protectedCollision = sources
    .filter(source => source.id !== current.id && isProtectedIdentitySource(source))
    .some(source => monitoringSourcesShareCanonicalIdentity(current, source))
  if (protectedCollision) throw new MonitoringSourceIdentityBlockedError()

  const linkedSubjects = input.db.monitoringSubject
    ? await input.db.monitoringSubject.findMany({
        where: {
          organizationId: input.organizationId,
          status: { not: "deleted" },
          sources: { some: { sourceId: current.id } },
        },
        select: monitoringIdentitySubjectSelect,
      })
    : []
  if (linkedSubjects.length === 0) return EMPTY_MONITORING_AUTHOR_IDENTITY

  const identity = mergeMonitoringAuthorIdentities(
    linkedSubjects.map(subject => monitoringAuthorIdentity(subject)),
  )
  if (monitoringSourceMatchesOwnedIdentity(current, identity)) {
    throw new MonitoringSourceIdentityBlockedError()
  }
  return identity
}
