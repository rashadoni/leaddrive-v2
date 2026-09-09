import { Prisma } from "@prisma/client"
import { withMobileRls } from "@/lib/with-mobile-rls"
import {
  handleMtmMobileSyncV2ReadonlyStream,
  type MtmMobileSyncV2ReadonlyStreamConfig,
} from "@/lib/mtm/mobile-sync-v2-readonly-stream"
import {
  mobileSyncV2WorkdayHorizon,
  mobileSyncV2WorkdayWhere,
  MTM_MOBILE_SYNC_V2_WORKFORCE_STREAM,
  projectMtmMobileSyncV2Workday,
} from "@/lib/mtm/mobile-sync-v2"

/**
 * The first workforce pilot is deliberately narrower than the v1 HRM
 * workspace. It carries only the authenticated agent's active workday state;
 * GPS coordinates, event notes, completed history, calendar policy, HRM
 * request reasons and decision notes remain on v1 until their own
 * privacy/horizon contract is approved.
 */
const workdayProjectionSelect = {
  id: true,
  workDate: true,
  status: true,
  startedAt: true,
  pausedAt: true,
  completedAt: true,
  totalPausedSeconds: true,
  updatedAt: true,
} satisfies Prisma.MtmAgentWorkdaySelect

type WorkdayProjectionSource = Prisma.MtmAgentWorkdayGetPayload<{
  select: typeof workdayProjectionSelect
}>

const config: MtmMobileSyncV2ReadonlyStreamConfig<
  WorkdayProjectionSource,
  ReturnType<typeof projectMtmMobileSyncV2Workday>
> = {
  stream: MTM_MOBILE_SYNC_V2_WORKFORCE_STREAM,
  entityType: "workday",
  endpoint: "GET /api/v2/mtm/mobile/sync/workforce",
  module: "workforceHrm",
  horizon: mobileSyncV2WorkdayHorizon,
  readSnapshotChunk: async ({ tx, organizationId, agentId, afterId, take }) => {
    return tx.mtmAgentWorkday.findMany({
      where: {
        ...mobileSyncV2WorkdayWhere({ organizationId, agentId }),
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: "asc" },
      take,
      select: workdayProjectionSelect,
    })
  },
  sourceId: (workday) => workday.id,
  project: projectMtmMobileSyncV2Workday,
  readDeltaProjections: async ({ tx, organizationId, agentId, entityIds }) => {
    const workdays = await tx.mtmAgentWorkday.findMany({
      where: {
        ...mobileSyncV2WorkdayWhere({ organizationId, agentId }),
        id: { in: [...entityIds] },
      },
      select: workdayProjectionSelect,
    })
    return new Map(workdays.map((workday) => [workday.id, projectMtmMobileSyncV2Workday(workday)]))
  },
}

/** GET /api/v2/mtm/mobile/sync/workforce — exact-cohort, read-only workday pilot. */
export const GET = withMobileRls(
  (req, auth) => handleMtmMobileSyncV2ReadonlyStream(req, auth, config),
  { requiredCapability: "workforce-hrm" },
)
