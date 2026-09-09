import { Prisma } from "@prisma/client"
import type { MtmRlsAuth } from "@/lib/with-mtm-rls-auth"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { pharmacyPromotionHash } from "@/lib/mtm/pharmacy-promotion"

type RouteActorPrisma = Parameters<typeof resolveMtmRouteActor>[0]

export const PHARMACY_PROMOTION_ADMIN_REQUIRED = "MTM_PHARMACY_ADMIN_REQUIRED"

export async function resolvePharmacyPromotionAdministrator(
  client: RouteActorPrisma,
  auth: MtmRlsAuth,
): Promise<MtmRouteActor | null> {
  if (auth.principal !== "web") return null
  const actor = await resolveMtmRouteActor(client, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  return actor?.role === "ADMIN" ? actor : null
}

/**
 * Re-resolve authorization inside the write transaction. The route-level
 * check keeps invalid callers out before body parsing, while this check closes
 * the permission-change window before an auditable configuration mutation.
 */
export async function requireCurrentPharmacyPromotionAdministrator(
  client: RouteActorPrisma,
  auth: MtmRlsAuth,
): Promise<MtmRouteActor> {
  const actor = await resolvePharmacyPromotionAdministrator(client, auth)
  if (!actor) throw new Error(PHARMACY_PROMOTION_ADMIN_REQUIRED)
  return actor
}

export function pharmacyPromotionDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export type PharmacyPromotionVersionDefinitionInput = {
  promotionId: string
  revision: number
  type: { id: string; code: string }
  nameRu: string
  nameAz: string
  nameEn: string
  descriptionRu?: string | null
  descriptionAz?: string | null
  descriptionEn?: string | null
  startsOn: Date | string
  endsOn: Date | string
  timezone: string
  formula: { id: string; version: number; definitionHash: string }
  approvalPolicy: { id: string; version: number; definitionHash: string }
  eligibilityDefinition: unknown
  eligibilityDefinitionHash: string
  sourceSystem: string
  sourceReference?: string | null
  sourceObservedAt: Date | string
}

/** The exact immutable envelope signed when a campaign revision is published. */
export function pharmacyPromotionVersionDefinition(input: PharmacyPromotionVersionDefinitionInput) {
  return {
    schemaVersion: 1,
    promotionId: input.promotionId,
    revision: input.revision,
    type: input.type,
    copy: {
      ru: { name: input.nameRu, description: input.descriptionRu ?? null },
      az: { name: input.nameAz, description: input.descriptionAz ?? null },
      en: { name: input.nameEn, description: input.descriptionEn ?? null },
    },
    period: {
      startsOn: new Date(input.startsOn).toISOString().slice(0, 10),
      endsOn: new Date(input.endsOn).toISOString().slice(0, 10),
      timezone: input.timezone,
    },
    formula: input.formula,
    approvalPolicy: input.approvalPolicy,
    eligibility: {
      definition: input.eligibilityDefinition,
      definitionHash: input.eligibilityDefinitionHash,
    },
    source: {
      system: input.sourceSystem,
      reference: input.sourceReference ?? null,
      observedAt: new Date(input.sourceObservedAt).toISOString(),
    },
  }
}

export function pharmacyPromotionVersionHash(input: PharmacyPromotionVersionDefinitionInput): string {
  return pharmacyPromotionHash(pharmacyPromotionVersionDefinition(input))
}

export function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}
