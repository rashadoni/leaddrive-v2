import { createHash } from "node:crypto"
import type { MtmRouteActor } from "@/lib/mtm/route-permissions"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { prisma } from "@/lib/prisma"
import { isValidTimezone } from "@/lib/timezone"

export function utcBrandPotentialDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export function brandPotentialRequestHash(contactId: string, value: unknown): string {
  return createHash("sha256").update(JSON.stringify({ contactId, value })).digest("hex")
}

export function canReviewBrandPotential(actor: MtmRouteActor): boolean {
  return actor.role === "ADMIN" || actor.role === "MANAGER" || actor.role === "SUPERVISOR"
}

export async function brandPotentialContext(auth: {
  orgId: string
  userId: string
  role: string
  agentId: string | null
}) {
  const [actor, settings] = await Promise.all([
    resolveMtmRouteActor(prisma, {
      organizationId: auth.orgId,
      userId: auth.userId,
      webRole: auth.role,
      agentId: auth.agentId,
    }),
    getMtmSettings(auth.orgId),
  ])
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const asOf = utcBrandPotentialDate(currentDateKey(new Date(), timezone))
  return { actor, settings, timezone, asOf }
}

export function scopedAgentIds(actor: MtmRouteActor): string[] | null {
  if (actor.role === "ADMIN" || actor.scopedAgentIds === null) return null
  if (actor.role === "AGENT") return actor.agentId ? [actor.agentId] : []
  return [...actor.scopedAgentIds]
}
