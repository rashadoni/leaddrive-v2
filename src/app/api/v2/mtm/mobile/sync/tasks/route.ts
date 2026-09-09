import { Prisma } from "@prisma/client"
import { withMobileRls } from "@/lib/with-mobile-rls"
import {
  handleMtmMobileSyncV2ReadonlyStream,
  type MtmMobileSyncV2ReadonlyStreamConfig,
} from "@/lib/mtm/mobile-sync-v2-readonly-stream"
import {
  mobileSyncV2ActiveTaskHorizon,
  mobileSyncV2ActiveTaskWhere,
  MTM_MOBILE_SYNC_V2_TASK_STREAM,
  projectMtmMobileSyncV2Task,
} from "@/lib/mtm/mobile-sync-v2"

/**
 * The tasks pilot carries schedule/state only. Title, description, result,
 * return reason, customer data, event comments/evidence and attachments stay
 * on the compatible v1 path until a separate product/privacy contract exists.
 */
const taskProjectionSelect = {
  id: true,
  visitId: true,
  status: true,
  priority: true,
  scheduledStartAt: true,
  dueDate: true,
  completedAt: true,
  progress: true,
  version: true,
  acceptedAt: true,
  startedAt: true,
  updatedAt: true,
} satisfies Prisma.MtmTaskSelect

type TaskProjectionSource = Prisma.MtmTaskGetPayload<{ select: typeof taskProjectionSelect }>

const config: MtmMobileSyncV2ReadonlyStreamConfig<
  TaskProjectionSource,
  ReturnType<typeof projectMtmMobileSyncV2Task>
> = {
  stream: MTM_MOBILE_SYNC_V2_TASK_STREAM,
  entityType: "task",
  endpoint: "GET /api/v2/mtm/mobile/sync/tasks",
  module: "routeField",
  horizon: () => mobileSyncV2ActiveTaskHorizon(),
  readSnapshotChunk: async ({ tx, organizationId, agentId, afterId, take }) => {
    return tx.mtmTask.findMany({
      where: {
        ...mobileSyncV2ActiveTaskWhere(organizationId, agentId),
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      orderBy: { id: "asc" },
      take,
      select: taskProjectionSelect,
    })
  },
  sourceId: (task) => task.id,
  project: projectMtmMobileSyncV2Task,
  readDeltaProjections: async ({ tx, organizationId, agentId, entityIds }) => {
    const tasks = await tx.mtmTask.findMany({
      where: {
        ...mobileSyncV2ActiveTaskWhere(organizationId, agentId),
        id: { in: [...entityIds] },
      },
      select: taskProjectionSelect,
    })
    return new Map(tasks.map((task) => [task.id, projectMtmMobileSyncV2Task(task)]))
  },
}

/** GET /api/v2/mtm/mobile/sync/tasks — exact-cohort, read-only pilot. */
export const GET = withMobileRls(
  (req, auth) => handleMtmMobileSyncV2ReadonlyStream(req, auth, config),
  { requiredCapability: "route-field" },
)
