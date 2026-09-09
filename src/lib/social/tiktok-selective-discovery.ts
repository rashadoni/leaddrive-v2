import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { getMonitoringScenarios, type MonitoringScenario } from "@/lib/social/monitoring-scenarios"
import { normalizeSubjectTerm } from "@/lib/social/monitoring-subjects"

export const TIKTOK_SELECTIVE_QUERY_PACK_CONTRACT = "tiktok-selective-query-pack-v1"
export const TIKTOK_DISCOVERY_CADENCE_MINUTES = 1440

export type TikTokQueryKind = "TERM" | "HASHTAG" | "HANDLE" | "DOMAIN"

export interface TikTokTenantQuery {
  kind: TikTokQueryKind
  query: string
  normalizedQuery: string
  scenarioIds: string[]
  subjectIds: string[]
  negativeTerms: string[]
}

export interface TikTokTenantQueryPack {
  contractVersion: typeof TIKTOK_SELECTIVE_QUERY_PACK_CONTRACT
  organizationId: string
  version: string
  cadenceMinutes: typeof TIKTOK_DISCOVERY_CADENCE_MINUTES
  queries: TikTokTenantQuery[]
}

type SubjectPolicy = {
  id: string
  exclusions: string[]
  aliases: Array<{ kind: string; value: string; normalizedValue: string; isNegative: boolean }>
}

function normalized(value: string): string {
  return normalizeSubjectTerm(value).replace(/\s+/g, " ").trim()
}

function domain(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "") || null
  } catch {
    return null
  }
}

function stableUnique(values: string[]): string[] {
  return Array.from(new Set(values.map(normalized).filter(Boolean))).sort()
}

function hash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

export function buildTikTokTenantQueryPack(input: {
  organizationId: string
  scenarios: MonitoringScenario[]
  subjects?: SubjectPolicy[]
  approvedExpansions?: Array<{ scenarioId: string; query: string; kind?: TikTokQueryKind }>
}): TikTokTenantQueryPack | null {
  const organizationId = input.organizationId.trim()
  if (!organizationId) throw new Error("TikTok query pack organizationId is required")
  const subjects = new Map((input.subjects ?? []).map(subject => [subject.id, subject]))
  const rows = new Map<string, TikTokTenantQuery>()

  const add = (scenario: MonitoringScenario, kind: TikTokQueryKind, raw: string) => {
    const query = kind === "HASHTAG" ? raw.replace(/^#+/, "") : kind === "HANDLE" ? raw.replace(/^@+/, "") : raw
    const normalizedQuery = normalized(query)
    if (!normalizedQuery) return
    const subject = scenario.subjectId ? subjects.get(scenario.subjectId) : undefined
    const negativeTerms = stableUnique([
      ...(subject?.exclusions ?? []),
      ...(subject?.aliases.filter(alias => alias.isNegative || alias.kind === "NEGATIVE").map(alias => alias.value) ?? []),
    ])
    const key = `${kind}:${normalizedQuery}`
    const existing = rows.get(key)
    rows.set(key, {
      kind,
      query: query.trim(),
      normalizedQuery,
      scenarioIds: Array.from(new Set([...(existing?.scenarioIds ?? []), scenario.id])).sort(),
      subjectIds: Array.from(new Set([...(existing?.subjectIds ?? []), ...(scenario.subjectId ? [scenario.subjectId] : [])])).sort(),
      negativeTerms: stableUnique([...(existing?.negativeTerms ?? []), ...negativeTerms]),
    })
  }

  for (const scenario of input.scenarios) {
    if (scenario.status !== "active" || !scenario.platforms.includes("tiktok")) continue
    scenario.search.topics.forEach(value => add(scenario, "TERM", value))
    scenario.search.keywords.forEach(value => add(scenario, "TERM", value))
    scenario.search.hashtags.forEach(value => add(scenario, "HASHTAG", value))
    scenario.search.handles.forEach(value => add(scenario, "HANDLE", value))
    scenario.search.urls.forEach(value => {
      const valueDomain = domain(value)
      if (valueDomain) add(scenario, "DOMAIN", valueDomain)
    })
    const subject = scenario.subjectId ? subjects.get(scenario.subjectId) : undefined
    subject?.aliases.filter(alias => !alias.isNegative && alias.kind !== "NEGATIVE" && alias.kind !== "CONTEXT").forEach(alias => {
      const kind: TikTokQueryKind = alias.kind === "HASHTAG" ? "HASHTAG" : alias.kind === "HANDLE" ? "HANDLE" : alias.kind === "DOMAIN" ? "DOMAIN" : "TERM"
      add(scenario, kind, alias.value)
    })
    input.approvedExpansions?.filter(expansion => expansion.scenarioId === scenario.id).forEach(expansion => add(scenario, expansion.kind ?? "TERM", expansion.query))
  }

  const queries = Array.from(rows.values()).sort((a, b) => `${a.kind}:${a.normalizedQuery}`.localeCompare(`${b.kind}:${b.normalizedQuery}`))
  if (queries.length === 0) return null
  const versionPayload = { contractVersion: TIKTOK_SELECTIVE_QUERY_PACK_CONTRACT, organizationId, queries }
  return {
    contractVersion: TIKTOK_SELECTIVE_QUERY_PACK_CONTRACT,
    organizationId,
    version: hash(versionPayload),
    cadenceMinutes: TIKTOK_DISCOVERY_CADENCE_MINUTES,
    queries,
  }
}

export async function loadTikTokTenantQueryPack(organizationId: string): Promise<TikTokTenantQueryPack | null> {
  const scenarios = await getMonitoringScenarios(organizationId)
  const subjectIds = Array.from(new Set(scenarios.filter(s => s.status === "active" && s.platforms.includes("tiktok")).map(s => s.subjectId).filter((id): id is string => Boolean(id))))
  const subjects = subjectIds.length === 0 ? [] : await prisma.monitoringSubject.findMany({
    where: { organizationId, id: { in: subjectIds }, status: "active" },
    select: { id: true, exclusions: true, aliases: { select: { kind: true, value: true, normalizedValue: true, isNegative: true } } },
  })
  return buildTikTokTenantQueryPack({ organizationId, scenarios, subjects })
}

export function tiktokDiscoveryWindow(now: Date): { since: Date; until: Date; windowKey: string } {
  if (!Number.isFinite(now.getTime())) throw new Error("TikTok discovery now must be valid")
  const until = new Date(now)
  const since = new Date(until.getTime() - TIKTOK_DISCOVERY_CADENCE_MINUTES * 60_000)
  return { since, until, windowKey: until.toISOString().slice(0, 10) }
}

export function tiktokDiscoveryDispatchIdempotencyKey(pack: TikTokTenantQueryPack, now: Date): string {
  return `tiktok-discovery:${pack.organizationId}:${pack.version}:${tiktokDiscoveryWindow(now).windowKey}`
}

export function isTikTokDiscoveryDue(input: { lastSuccessfulAt: Date | null; now: Date }): boolean {
  if (!input.lastSuccessfulAt) return true
  return input.now.getTime() - input.lastSuccessfulAt.getTime() >= TIKTOK_DISCOVERY_CADENCE_MINUTES * 60_000
}

export function prepareTikTokSelectiveDiscovery(input: {
  organizationId: string
  scenarios: MonitoringScenario[]
  subjects?: SubjectPolicy[]
  approvedExpansions?: Array<{ scenarioId: string; query: string; kind?: TikTokQueryKind }>
  lastSuccessfulAt: Date | null
  now: Date
}): (TikTokTenantQueryPack & { dispatchIdempotencyKey: string; since: Date; until: Date }) | null {
  if (!isTikTokDiscoveryDue(input)) return null
  const pack = buildTikTokTenantQueryPack(input)
  if (!pack) return null
  const window = tiktokDiscoveryWindow(input.now)
  return { ...pack, dispatchIdempotencyKey: tiktokDiscoveryDispatchIdempotencyKey(pack, input.now), since: window.since, until: window.until }
}
