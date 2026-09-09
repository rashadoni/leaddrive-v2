export type SocialMonitoringRunJobKind =
  | "PROFILE_FULL"
  | "SOURCE_FULL"
  | "WEB_NEWS"

export type SocialMonitoringRunJobSourceScope = "OWNED" | "EXTERNAL"

export type SocialMonitoringRunJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_PROVIDER"
  | "CANCEL_REQUESTED"
  | "COMPLETED"
  | "COMPLETED_WITH_ISSUES"
  | "CANCELED"
  | "FAILED"

export type SocialMonitoringRunJobItemStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_PROVIDER"
  | "SUCCEEDED"
  | "PARTIAL"
  | "SKIPPED"
  | "FAILED"
  | "TIMED_OUT"

export type SocialMonitoringRunJobItem = {
  id: string
  position: number
  subjectId: string | null
  profileName: string | null
  sourceId: string | null
  sourceLabel: string | null
  sourcePlatform: string | null
  status: SocialMonitoringRunJobItemStatus
  foundCount: number
  newCount: number
  error: string | null
}

export type SocialMonitoringRunJob = {
  id: string
  kind: SocialMonitoringRunJobKind
  sourceScope: SocialMonitoringRunJobSourceScope | null
  status: SocialMonitoringRunJobStatus
  totalItems: number
  processedItems: number
  foundCount: number
  newCount: number
  currentItem: {
    sourceLabel?: string | null
    profileName?: string | null
  } | null
  items: SocialMonitoringRunJobItem[]
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type SocialMonitoringRunJobApiResponse = {
  success?: boolean
  error?: string
  data?: SocialMonitoringRunJob | null
}

const ACTIVE_JOB_STATUSES = new Set<SocialMonitoringRunJobStatus>([
  "QUEUED",
  "RUNNING",
  "WAITING_PROVIDER",
  "CANCEL_REQUESTED",
])

const ACTIVE_ITEM_STATUSES = new Set<SocialMonitoringRunJobItemStatus>([
  "QUEUED",
  "RUNNING",
  "WAITING_PROVIDER",
])

const SUCCESS_ITEM_STATUSES = new Set<SocialMonitoringRunJobItemStatus>([
  "SUCCEEDED",
])

const ISSUE_ITEM_STATUSES = new Set<SocialMonitoringRunJobItemStatus>([
  "PARTIAL",
  "SKIPPED",
  "FAILED",
  "TIMED_OUT",
])

export function socialMonitoringRunJobIsActive(
  job: SocialMonitoringRunJob | null | undefined,
): boolean {
  return Boolean(job && ACTIVE_JOB_STATUSES.has(job.status))
}

export function socialMonitoringRunJobCanResume(
  job: SocialMonitoringRunJob | null | undefined,
): boolean {
  return job?.status === "CANCELED" || job?.status === "FAILED"
}

export function socialMonitoringRunJobItemIsExecuting(
  item: SocialMonitoringRunJobItem,
): boolean {
  return item.status === "RUNNING" || item.status === "WAITING_PROVIDER"
}

export type SocialMonitoringRunJobQueueState =
  | "queued"
  | "running"
  | "completed"
  | "issue"

export function socialMonitoringRunJobProfileQueueState(
  job: SocialMonitoringRunJob | null | undefined,
  profile: { subjectId: string | null; name: string },
): SocialMonitoringRunJobQueueState | undefined {
  if (!job || job.kind !== "PROFILE_FULL" || !profile.subjectId) return undefined
  const items = job.items.filter(item => item.subjectId === profile.subjectId)
  if (items.length === 0) return undefined

  const jobActive = socialMonitoringRunJobIsActive(job)
  const currentProfileMatches = job.currentItem?.profileName === profile.name
  if (jobActive && (
    currentProfileMatches
    || items.some(item => item.status === "RUNNING" || item.status === "WAITING_PROVIDER")
  )) return "running"

  const allSucceeded = items.every(item => SUCCESS_ITEM_STATUSES.has(item.status))
  if (allSucceeded) return "completed"

  const allTerminal = items.every(item => (
    SUCCESS_ITEM_STATUSES.has(item.status) || ISSUE_ITEM_STATUSES.has(item.status)
  ))
  if (allTerminal || !jobActive) return "issue"

  return "queued"
}

export function socialMonitoringRunJobProfileCounts(
  job: SocialMonitoringRunJob,
): { total: number; processed: number } {
  const profiles = new Map<string, SocialMonitoringRunJobItem[]>()
  for (const item of job.items) {
    const key = item.subjectId || item.profileName || item.id
    const group = profiles.get(key) ?? []
    group.push(item)
    profiles.set(key, group)
  }

  let processed = 0
  for (const items of profiles.values()) {
    if (items.every(item => !ACTIVE_ITEM_STATUSES.has(item.status))) processed += 1
  }
  return { total: profiles.size, processed }
}

export async function readSocialMonitoringRunJobResponse(
  response: Response,
): Promise<SocialMonitoringRunJobApiResponse> {
  const text = await response.text()
  try {
    return JSON.parse(text) as SocialMonitoringRunJobApiResponse
  } catch {
    return { success: false, error: "monitoring_run_job_invalid_response" }
  }
}
