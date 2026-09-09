type GroupableSignal = { id: string }
type GroupableRun = { id: string }

export type GroupableMediaObservation = {
  id: string
  mentionId?: string | null
  discoveryLeadId?: string | null
  mediaType: string
  status: string
  sourceUrl: string
  canonicalMediaUrl?: string | null
  thumbnailUrl?: string | null
  audioUrl?: string | null
  platformTranscript?: string | null
  durationMs?: number | null
  language?: string | null
  relevanceScore?: number
  signals: GroupableSignal[]
  runs: GroupableRun[]
}

export type GroupedMediaObservation<T extends GroupableMediaObservation> = T & {
  assetCount: number
  mediaTypes: string[]
}

const STATUS_SCORE: Record<string, number> = {
  COMPLETE: 50,
  PARTIAL: 45,
  PROCESSING: 20,
  QUEUED: 15,
  FAILED: 5,
  BLOCKED: 0,
  DROPPED: -5,
  PURGED: -10,
}

const MEDIA_TYPE_SCORE: Record<string, number> = {
  VIDEO: 20,
  IMAGE: 10,
  AUDIO: 5,
}

function observationGroupKey(observation: GroupableMediaObservation): string {
  if (observation.mentionId) return `mention:${observation.mentionId}`
  if (observation.discoveryLeadId) return `lead:${observation.discoveryLeadId}`
  return `asset:${observation.canonicalMediaUrl || observation.sourceUrl || observation.id}`
}

function representativeScore(observation: GroupableMediaObservation): number {
  return (STATUS_SCORE[observation.status] ?? 0)
    + (MEDIA_TYPE_SCORE[observation.mediaType] ?? 0)
    + (observation.platformTranscript?.trim() ? 8 : 0)
    + (observation.thumbnailUrl ? 3 : 0)
    + (observation.durationMs ? 2 : 0)
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function firstValue<T>(items: T[], read: (item: T) => string | number | null | undefined) {
  for (const item of items) {
    const value = read(item)
    if (value !== null && value !== undefined && value !== "") return value
  }
  return null
}

/**
 * A social post can create several storage rows (video, cover, audio and
 * carousel images). The dashboard is post-oriented, so return one card per
 * originating post while retaining every asset type and extraction signal.
 */
export function groupMediaDashboardObservations<T extends GroupableMediaObservation>(
  observations: T[],
): Array<GroupedMediaObservation<T>> {
  const groups = new Map<string, T[]>()
  for (const observation of observations) {
    const key = observationGroupKey(observation)
    const existing = groups.get(key)
    if (existing) existing.push(observation)
    else groups.set(key, [observation])
  }

  return Array.from(groups.values()).map(group => {
    const representative = group.reduce((best, candidate) => (
      representativeScore(candidate) > representativeScore(best) ? candidate : best
    ))
    const relevanceScore = Math.max(...group.map(item => item.relevanceScore ?? 0))

    return {
      ...representative,
      thumbnailUrl: representative.thumbnailUrl ?? firstValue(group, item => item.thumbnailUrl),
      audioUrl: representative.audioUrl ?? firstValue(group, item => item.audioUrl),
      platformTranscript: representative.platformTranscript ?? firstValue(group, item => item.platformTranscript),
      durationMs: representative.durationMs ?? firstValue(group, item => item.durationMs),
      language: representative.language ?? firstValue(group, item => item.language),
      relevanceScore,
      signals: uniqueById(group.flatMap(item => item.signals)).slice(0, 20),
      runs: uniqueById(group.flatMap(item => item.runs)).slice(0, 20),
      assetCount: group.length,
      mediaTypes: Array.from(new Set(group.map(item => item.mediaType))).sort(),
    } as GroupedMediaObservation<T>
  })
}
