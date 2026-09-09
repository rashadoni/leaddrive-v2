export type MediaObservationRelevance = "confirmed" | "likely" | "unverified"
export type MediaObservationRelevanceFilter = "relevant" | MediaObservationRelevance | "all"
export type MediaObservationSentimentFilter = "" | "negative" | "neutral" | "positive" | "unknown"

export type FilterableMediaObservation = {
  platform: string | null
  mediaType: string
  mediaTypes?: string[]
  sourceUrl: string
  canonicalMediaUrl: string | null
  platformTranscript: string | null
  relevanceScore: number
  subject: { id: string; name: string } | null
  mention: {
    text: string | null
    authorHandle: string | null
    platform: string
    sentiment?: string | null
    matchedTerm?: string | null
    subjectMatches?: Array<{
      status: string
      subjectId: string
      subject: { id: string; name: string } | null
    }>
  } | null
  signals: Array<{
    text: string | null
    matchedTerms: string[]
    subjectId?: string | null
  }>
}

export type MediaObservationFilters = {
  query: string
  subjectId: string
  platform: string
  mediaType: string
  relevance: MediaObservationRelevanceFilter
  sentiment?: MediaObservationSentimentFilter
}

function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

export function mediaObservationSubject(observation: FilterableMediaObservation): { id: string; name: string } | null {
  if (observation.subject) return observation.subject
  return observation.mention?.subjectMatches
    ?.find(match => match.status === "MATCHED" && match.subject)?.subject ?? null
}

function mediaObservationSubjectIds(observation: FilterableMediaObservation): Set<string> {
  return new Set([
    observation.subject?.id,
    ...(observation.mention?.subjectMatches
      ?.filter(match => match.status === "MATCHED")
      .map(match => match.subjectId) ?? []),
    ...observation.signals.map(signal => signal.subjectId),
  ].filter((value): value is string => Boolean(value)))
}

export function mediaObservationRelevance(observation: FilterableMediaObservation): MediaObservationRelevance {
  if (normalizeSearchText(observation.mention?.matchedTerm)) return "confirmed"
  if (observation.signals.some(signal => signal.matchedTerms.some(term => normalizeSearchText(term).length > 0))) {
    return "confirmed"
  }

  const subjectName = normalizeSearchText(mediaObservationSubject(observation)?.name)
  if (subjectName) {
    const evidenceText = [
      observation.mention?.text,
      observation.platformTranscript,
      ...observation.signals.map(signal => signal.text),
    ].map(normalizeSearchText)
    if (evidenceText.some(value => value.includes(subjectName))) return "confirmed"
  }

  if (mediaObservationSubject(observation) && observation.relevanceScore >= 0.6) return "likely"
  return "unverified"
}

export function mediaObservationMatchesFilters(
  observation: FilterableMediaObservation,
  filters: MediaObservationFilters,
): boolean {
  const relevance = mediaObservationRelevance(observation)
  if (filters.relevance === "relevant" && relevance === "unverified") return false
  if (!["all", "relevant"].includes(filters.relevance) && relevance !== filters.relevance) return false
  if (filters.subjectId && !mediaObservationSubjectIds(observation).has(filters.subjectId)) return false

  const platform = observation.platform ?? observation.mention?.platform ?? "manual"
  if (filters.platform && platform !== filters.platform) return false
  if (filters.mediaType && !(observation.mediaTypes ?? [observation.mediaType]).includes(filters.mediaType)) return false
  const sentiment = normalizeSearchText(observation.mention?.sentiment)
  if (filters.sentiment === "unknown" && sentiment) return false
  if (filters.sentiment && filters.sentiment !== "unknown" && sentiment !== filters.sentiment) return false

  const query = normalizeSearchText(filters.query)
  if (!query) return true
  const searchable = [
    mediaObservationSubject(observation)?.name,
    observation.mention?.authorHandle,
    observation.mention?.text,
    observation.mention?.matchedTerm,
    observation.platformTranscript,
    platform,
    observation.mediaType,
    ...observation.signals.flatMap(signal => [signal.text, ...signal.matchedTerms]),
  ].map(normalizeSearchText)
  return searchable.some(value => value.includes(query))
}

export function mediaObservationFilterCounts(observations: FilterableMediaObservation[]): Record<MediaObservationRelevance, number> {
  const counts: Record<MediaObservationRelevance, number> = { confirmed: 0, likely: 0, unverified: 0 }
  for (const observation of observations) counts[mediaObservationRelevance(observation)] += 1
  return counts
}
