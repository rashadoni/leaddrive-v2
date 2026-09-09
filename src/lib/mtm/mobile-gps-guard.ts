import type { MobileAuthResult } from "@/lib/mobile-auth"
import { prisma } from "@/lib/prisma"
import { parseMobileSyncV2DeviceId } from "@/lib/mtm/mobile-sync-v2"

/**
 * `gps` is an independent rollout stream. It deliberately does not reuse the
 * route-sync cohort: GPS has a very different load profile and must be
 * reversible without changing route reads.
 */
export const MTM_MOBILE_GPS_BATCH_COHORT_STREAM = "gps"

export type MtmMobileGpsBatchPilot = {
  enrolled: boolean
  deviceId: string | null
  cohortEpoch: string | null
}

function isMissingAdditiveCohortTable(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error
    && (error as { code?: unknown }).code === "P2021"
}

/**
 * A GPS batch is v2-only, so there is no legacy fallback in this decision:
 * a valid client device ID and an exact server-owned cohort row are both
 * required. This prevents a mutable request header from opting an APK in.
 * During schema-first deployment, a missing additive cohort table simply
 * leaves the new endpoint off rather than breaking v1 location uploads.
 */
export async function readMtmMobileGpsBatchPilot(input: {
  auth: Pick<MobileAuthResult, "orgId" | "agentId">
  deviceId: string | null
  now?: Date
}): Promise<MtmMobileGpsBatchPilot> {
  const deviceId = parseMobileSyncV2DeviceId(input.deviceId)
  if (!deviceId) return { enrolled: false, deviceId: null, cohortEpoch: null }
  try {
    const cohort = await prisma.mtmMobileSyncCohort.findFirst({
      where: {
        organizationId: input.auth.orgId,
        stream: MTM_MOBILE_GPS_BATCH_COHORT_STREAM,
        agentId: input.auth.agentId,
        deviceId,
        enabled: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: input.now ?? new Date() } }],
      },
      select: { updatedAt: true },
    })
    return {
      enrolled: !!cohort,
      deviceId,
      cohortEpoch: cohort?.updatedAt.toISOString() ?? null,
    }
  } catch (error) {
    if (isMissingAdditiveCohortTable(error)) {
      return { enrolled: false, deviceId, cohortEpoch: null }
    }
    throw error
  }
}
