import { createHash } from "node:crypto"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey } from "@/lib/mtm/mobile-week"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { prisma } from "@/lib/prisma"
import { isValidTimezone } from "@/lib/timezone"

export function utcDoctorScoringDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

export function doctorAssessmentRequestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export async function doctorScoringContext(auth: {
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
  const asOf = utcDoctorScoringDate(currentDateKey(new Date(), timezone))
  return { actor, timezone, asOf }
}
