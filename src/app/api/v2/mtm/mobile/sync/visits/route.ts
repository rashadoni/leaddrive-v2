import { Prisma } from "@prisma/client"
import { withMobileRls } from "@/lib/with-mobile-rls"
import {
  handleMtmMobileSyncV2ReadonlyStream,
  type MtmMobileSyncV2ReadonlyStreamConfig,
} from "@/lib/mtm/mobile-sync-v2-readonly-stream"
import {
  mobileSyncV2ActiveVisitHorizon,
  mobileSyncV2ActiveVisitWhere,
  MTM_MOBILE_SYNC_V2_VISIT_STREAM,
  projectMtmMobileSyncV2Visit,
} from "@/lib/mtm/mobile-sync-v2"

/**
 * `visits` is intentionally a narrow comparison stream, not a replacement
 * for the richer v1 workspace. It omits customer/contact data, coordinates,
 * notes, requirements, action evidence and every media reference.
 */
const visitProjectionSelect = {
  id: true,
  routeId: true,
  routePointId: true,
  status: true,
  checkInAt: true,
  checkOutAt: true,
  duration: true,
  outcome: true,
  potential: true,
  nextActionDueAt: true,
  updatedAt: true,
} satisfies Prisma.MtmVisitSelect

type VisitProjectionSource = Prisma.MtmVisitGetPayload<{ select: typeof visitProjectionSelect }>

const config: MtmMobileSyncV2ReadonlyStreamConfig<
  VisitProjectionSource,
  ReturnType<typeof projectMtmMobileSyncV2Visit>
> = {
  stream: MTM_MOBILE_SYNC_V2_VISIT_STREAM,
  entityType: "visit",
  endpoint: "GET /api/v2/mtm/mobile/sync/visits",
  module: "routeField",
  horizon: () => mobileSyncV2ActiveVisitHorizon(),
  readSnapshotChunk: async ({ tx, organizationId, agentId, afterId, take }) => {
    return tx.mtmVisit.findMany({
      where: {
        ...mobileSyncV2ActiveVisitWhere(organizationId, agentId),
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: "asc" },
      take,
      select: visitProjectionSelect,
    })
  },
  sourceId: (visit) => visit.id,
  project: projectMtmMobileSyncV2Visit,
  readDeltaProjections: async ({ tx, organizationId, agentId, entityIds }) => {
    const visits = await tx.mtmVisit.findMany({
      where: {
        ...mobileSyncV2ActiveVisitWhere(organizationId, agentId),
        id: { in: [...entityIds] },
      },
      select: visitProjectionSelect,
    })
    return new Map(visits.map((visit) => [visit.id, projectMtmMobileSyncV2Visit(visit)]))
  },
}

/** GET /api/v2/mtm/mobile/sync/visits — exact-cohort, read-only pilot. */
export const GET = withMobileRls(
  (req, auth) => handleMtmMobileSyncV2ReadonlyStream(req, auth, config),
  { requiredCapability: "route-field" },
)
