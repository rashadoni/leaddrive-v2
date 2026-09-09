/**
 * Phase 8 (inbox redesign) slice-1 — read-only message analytics. Pure +
 * server-safe (no React/Prisma imports). Shapes the org-scoped
 * `channelMessage.groupBy({ by: [channelType, direction] })` rows the API runs into
 * a totals + per-channel breakdown the page renders.
 *
 * slice-1 is MESSAGE-level only (unambiguous from ChannelMessage). Conversation
 * metrics (FRT/AHT, resolved-rate) are slice-2: they need per-conversation timing
 * and only ~4/9 channels persist a SocialConversation, so they'd be partial — left
 * out rather than shipped half-true.
 */

/** A `channelMessage.groupBy({ by: ["channelType","direction"], _count: {_all} })` row.
 *  channelType is nullable on ChannelMessage, so a null group is possible. */
export interface MessageGroupRow {
  channelType: string | null
  direction: string
  _count: { _all: number }
}

export interface ChannelAnalytics {
  channel: string
  total: number
  inbound: number
  outbound: number
}

export interface MessageAnalytics {
  total: number
  inbound: number
  outbound: number
  /** Per-channel rows, sorted by total DESC (channel name ASC breaks ties — stable). */
  byChannel: ChannelAnalytics[]
}

/**
 * Fold grouped (channelType, direction) counts into org totals + a per-channel
 * breakdown. Only "inbound"/"outbound" directions contribute to the in/out splits;
 * any other direction still counts toward totals but neither split (defensive —
 * the column is normally just those two).
 */
export function summarizeMessageAnalytics(rows: MessageGroupRow[]): MessageAnalytics {
  const byChannelMap = new Map<string, ChannelAnalytics>()
  let total = 0
  let inbound = 0
  let outbound = 0

  for (const r of rows) {
    const c = r._count?._all ?? 0
    if (c <= 0) continue
    // channelType is nullable — fold a null group under "unknown" so the label/
    // colour helpers + the name-tiebreak sort never receive null.
    const channel = r.channelType ?? "unknown"
    total += c
    if (r.direction === "inbound") inbound += c
    else if (r.direction === "outbound") outbound += c

    const entry = byChannelMap.get(channel) ?? { channel, total: 0, inbound: 0, outbound: 0 }
    entry.total += c
    if (r.direction === "inbound") entry.inbound += c
    else if (r.direction === "outbound") entry.outbound += c
    byChannelMap.set(channel, entry)
  }

  const byChannel = [...byChannelMap.values()].sort(
    (a, b) => b.total - a.total || a.channel.localeCompare(b.channel),
  )
  return { total, inbound, outbound, byChannel }
}

/** Integer percentage of `part` over `whole` (0 when whole is 0). For the UI bars. */
export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 100)
}

/* ── B2 — channel AI-effectiveness trend (7-day vs 30-day window) ── */

export interface ChannelAiTrend {
  shortPct: number
  longPct: number
  dir: "up" | "down"
}

/**
 * Compare a channel's AI-closed share between the short (7-day) and long
 * (30-day) windows. `currentPct` is the pct of the window the card is
 * displaying, `otherPct` the opposite window's; `currentIsShort` says which
 * is which. Returns null when either window has no closures (pct null) or
 * the delta is below `thresholdPt` points — no arrow is rendered then.
 */
export function channelAiTrend(
  currentPct: number | null,
  otherPct: number | null,
  currentIsShort: boolean,
  thresholdPt = 3,
): ChannelAiTrend | null {
  const shortPct = currentIsShort ? currentPct : otherPct
  const longPct = currentIsShort ? otherPct : currentPct
  if (shortPct == null || longPct == null) return null
  if (Math.abs(shortPct - longPct) < thresholdPt) return null
  return { shortPct, longPct, dir: shortPct > longPct ? "up" : "down" }
}

/* ── Phase 8 slice-2 — conversation status metrics (resolution-rate + breakdown) ──
 * SCOPED to SocialConversation-backed conversations only — the social channels
 * (telegram/whatsapp/facebook/instagram/vk) that persist a row. Email/SMS threads
 * have no SocialConversation, so they are NOT counted here; the page labels this
 * "tracked / social-channel conversations". FRT/AHT (per-conversation message
 * timing) are slice-3 — left out rather than shipped as a heavy half-metric. */

export interface ConversationStatusRow {
  status: string
  _count: { _all: number }
}

export interface ConversationAnalytics {
  total: number
  open: number
  resolved: number
  archived: number
  other: number
  /** Integer %: resolved / total; 0 when there are no conversations. NOTE: this is a
   *  COHORT rate over conversations *created* in the queried window, scored by their
   *  CURRENT status (there is no resolvedAt column) — it is NOT "% resolved during the
   *  period". The page labels it as such. `archived` is a SEPARATE disposition (often
   *  "dismissed", not "resolved"), NOT counted here — it shows in the breakdown only. */
  resolutionRate: number
}

/** Combined analytics payload: message volume (slice-1) + conversation status (slice-2). */
export interface InboxAnalytics extends MessageAnalytics {
  conversations: ConversationAnalytics
}

/**
 * Fold `socialConversation.groupBy({ by: ["status"] })` counts into a status
 * breakdown + resolution rate. Statuses are the SocialConversation whitelist
 * (open | resolved | archived); any other value lands in `other` (defensive).
 * resolutionRate is resolved/total ONLY — `archived` is a distinct disposition,
 * counted in the breakdown but not as a resolution.
 */
export function summarizeConversationStats(rows: ConversationStatusRow[]): ConversationAnalytics {
  let total = 0
  let open = 0
  let resolved = 0
  let archived = 0
  let other = 0
  for (const r of rows) {
    const c = r._count?._all ?? 0
    if (c <= 0) continue
    total += c
    switch (r.status) {
      case "open": open += c; break
      case "resolved": resolved += c; break
      case "archived": archived += c; break
      default: other += c
    }
  }
  return { total, open, resolved, archived, other, resolutionRate: pct(resolved, total) }
}

/* ── Phase 8 slice-3 — First Response Time (FRT) ──────────────────────────────
 * Minutes from the FIRST inbound message of a conversation to the FIRST outbound
 * message that follows it. Social-channel-scoped (same SocialConversation backing as
 * slice-2). slice-3 is FRT ONLY — AHT/handle-time needs a resolution timestamp the
 * schema doesn't have (no resolvedAt), which is a later migration. The route caps the
 * number of conversations scanned (declared, never silent) since this is the one
 * per-conversation scan in the analytics surface. */

export interface FrtMessageRow {
  conversationId: string
  direction: string
  createdAt: string | Date
}

export interface FrtStats {
  /** Conversations with ≥1 inbound message — FRT is only defined for these. */
  conversations: number
  /** Of those, how many got an outbound reply AFTER the first inbound. */
  answered: number
  /** Inbound-but-never-answered. */
  unanswered: number
  /** Median first-response minutes over answered conversations; null if none answered. */
  medianMinutes: number | null
  /** Mean first-response minutes over answered conversations; null if none answered. */
  avgMinutes: number | null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return round1(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2)
}

/** Per-conversation FRT, the shared primitive behind `computeFrtStats`, the SLA
 *  distribution, and per-agent stats. `hasInbound` is false for agent-initiated
 *  threads (FRT undefined); `frtMin` is null when there's an inbound but no reply yet. */
export interface PerConvFrt {
  conversationId: string
  hasInbound: boolean
  frtMin: number | null
}

/**
 * Reduce raw (conversationId, direction, createdAt) rows to one PerConvFrt per
 * conversation. Pure: sorts each conversation's messages internally (doesn't trust input
 * order), skips unparseable timestamps. FRT = first outbound at or after the first inbound,
 * minus the first inbound, in minutes.
 */
export function perConversationFrt(rows: FrtMessageRow[]): PerConvFrt[] {
  const byConv = new Map<string, { dir: string; t: number }[]>()
  for (const r of rows) {
    const t = new Date(r.createdAt).getTime()
    if (Number.isNaN(t)) continue
    const arr = byConv.get(r.conversationId) ?? []
    arr.push({ dir: r.direction, t })
    byConv.set(r.conversationId, arr)
  }
  const out: PerConvFrt[] = []
  for (const [conversationId, msgs] of byConv) {
    msgs.sort((a, b) => a.t - b.t)
    const firstInbound = msgs.find((m) => m.dir === "inbound")
    if (!firstInbound) { out.push({ conversationId, hasInbound: false, frtMin: null }); continue }
    const firstReply = msgs.find((m) => m.dir === "outbound" && m.t >= firstInbound.t)
    out.push({ conversationId, hasInbound: true, frtMin: firstReply ? (firstReply.t - firstInbound.t) / 60_000 : null })
  }
  return out
}

/** Just the answered-conversation FRT minutes (hasInbound + a reply). For SLA/distribution. */
function frtMinutes(rows: FrtMessageRow[]): number[] {
  return perConversationFrt(rows).filter((p) => p.hasInbound && p.frtMin != null).map((p) => p.frtMin as number)
}

/**
 * Aggregate FRT over the messages of the in-scope conversations. A conversation with no
 * inbound is ignored (FRT is undefined for an agent-initiated thread). Behaviour identical
 * to the pre-refactor version — now layered on `perConversationFrt`.
 */
export function computeFrtStats(rows: FrtMessageRow[]): FrtStats {
  const per = perConversationFrt(rows).filter((p) => p.hasInbound)
  const frts = per.filter((p) => p.frtMin != null).map((p) => p.frtMin as number)
  const conversations = per.length
  return {
    conversations,
    answered: frts.length,
    unanswered: conversations - frts.length,
    medianMinutes: median(frts),
    avgMinutes: frts.length ? round1(frts.reduce((s, x) => s + x, 0) / frts.length) : null,
  }
}

/* ── Expanded reporting (omni-channel) — pure shapers for the new sections ──────────
 * All pure + server-safe (no Prisma/React). The routes run the org-scoped queries and
 * hand the rows here. Covers: per-agent performance, temporal (heatmap + trend),
 * SLA + FRT distribution, backlog aging, and per-platform conversation breakdown. */

/* ── Section 1 — per-agent performance ── */

/** A conversation row for per-agent rollup. `assignedTo` is the User id (null = unassigned).
 *  `conversationId` matches the conversationId on the FRT message rows. */
export interface AgentConvRow {
  conversationId: string
  assignedTo: string | null
  status: string
  unreadCount: number
}

export interface AgentPerformance {
  /** User id, or null for the unassigned bucket. */
  agentId: string | null
  /** Resolved display name; "" for the unassigned bucket (UI supplies the label). */
  agentName: string
  assigned: number
  resolved: number
  /** Integer %: resolved / assigned. */
  resolutionRate: number
  /** Median first-response minutes over this agent's answered conversations; null if none. */
  medianFrtMinutes: number | null
  /** Sum of unreadCount across this agent's conversations (backlog signal). */
  unread: number
}

const UNASSIGNED = "__unassigned__"

/**
 * Roll conversations up by `assignedTo`, joining per-conversation FRT for a median per agent.
 * `names` maps User id → display name. Unassigned conversations fold into one bucket
 * (agentId null). Sorted by assigned DESC, then name ASC (stable).
 */
export function summarizeAgentPerformance(
  convs: AgentConvRow[],
  frtRows: FrtMessageRow[],
  names: Record<string, string>,
): AgentPerformance[] {
  const frtByConv = new Map(perConversationFrt(frtRows).map((p) => [p.conversationId, p.frtMin]))
  const map = new Map<string, { assigned: number; resolved: number; unread: number; frts: number[] }>()
  for (const c of convs) {
    const key = c.assignedTo ?? UNASSIGNED
    const e = map.get(key) ?? { assigned: 0, resolved: 0, unread: 0, frts: [] }
    e.assigned++
    if (c.status === "resolved") e.resolved++
    e.unread += c.unreadCount || 0
    const f = frtByConv.get(c.conversationId)
    if (f != null) e.frts.push(f)
    map.set(key, e)
  }
  return [...map.entries()]
    .map(([key, e]) => ({
      agentId: key === UNASSIGNED ? null : key,
      agentName: key === UNASSIGNED ? "" : (names[key] ?? key),
      assigned: e.assigned,
      resolved: e.resolved,
      resolutionRate: pct(e.resolved, e.assigned),
      medianFrtMinutes: median(e.frts),
      unread: e.unread,
    }))
    .sort((a, b) => b.assigned - a.assigned || a.agentName.localeCompare(b.agentName))
}

/* ── Section 2 — temporal (busiest-hours heatmap + daily trend) ── */

/** A `GROUP BY EXTRACT(DOW), EXTRACT(HOUR), direction` row (Postgres DOW: 0=Sun..6=Sat). */
export interface HeatmapRow {
  dow: number | string
  hour: number | string
  direction: string
  count: number | string | bigint
}

/** A `GROUP BY date_trunc('day'), direction` row. `day` is an ISO date (or Date). */
export interface TrendDayRow {
  day: string | Date
  direction: string
  count: number | string | bigint
}

/** 7×24 grid of INBOUND message counts (when customers write — staffing signal).
 *  grid[dow][hour], dow 0=Sun..6=Sat to match Postgres EXTRACT(DOW). */
export function shapeHeatmap(rows: HeatmapRow[]): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[])
  for (const r of rows) {
    if (r.direction !== "inbound") continue
    const d = Math.round(Number(r.dow))
    const h = Math.round(Number(r.hour))
    if (d >= 0 && d < 7 && h >= 0 && h < 24) grid[d][h] += Number(r.count) || 0
  }
  return grid
}

/** Daily inbound/outbound series, sorted by date ASC. Date normalized to YYYY-MM-DD. */
export function shapeTrend(rows: TrendDayRow[]): { date: string; inbound: number; outbound: number }[] {
  const map = new Map<string, { inbound: number; outbound: number }>()
  for (const r of rows) {
    const date = typeof r.day === "string" ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10)
    const e = map.get(date) ?? { inbound: 0, outbound: 0 }
    const c = Number(r.count) || 0
    if (r.direction === "inbound") e.inbound += c
    else if (r.direction === "outbound") e.outbound += c
    map.set(date, e)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, ...v }))
}

/* ── Section 3 — SLA compliance + FRT distribution + backlog aging ── */

export interface SlaDistribution {
  /** SLA threshold in minutes (caller-supplied; default 30 at the route). */
  threshold: number
  /** % of answered conversations whose FRT ≤ threshold. */
  slaMetPct: number
  /** Answered conversations (denominator). */
  answered: number
  /** Fixed FRT buckets: <5m, 5–15m, 15–30m, 30–60m, >60m. */
  distribution: { label: string; count: number }[]
}

const FRT_EDGES = [5, 15, 30, 60]
const FRT_LABELS = ["<5m", "5–15m", "15–30m", "30–60m", ">60m"]

/** SLA-met % + a fixed FRT histogram, derived from the same FRT message rows. */
export function computeSlaDistribution(rows: FrtMessageRow[], thresholdMin: number): SlaDistribution {
  const frts = frtMinutes(rows)
  const counts = new Array(FRT_LABELS.length).fill(0) as number[]
  let within = 0
  for (const m of frts) {
    if (m <= thresholdMin) within++
    let idx = FRT_EDGES.findIndex((e) => m < e)
    if (idx < 0) idx = FRT_EDGES.length
    counts[idx]++
  }
  return {
    threshold: thresholdMin,
    slaMetPct: pct(within, frts.length),
    answered: frts.length,
    distribution: FRT_LABELS.map((label, i) => ({ label, count: counts[i] })),
  }
}

export interface BacklogAging {
  /** Open-conversation age buckets: <1h, 1–4h, 4–24h, >24h. */
  buckets: { label: string; count: number }[]
  total: number
  /** Oldest open conversation age in hours (1-dp), null if none open. */
  oldestHours: number | null
}

const AGE_EDGES = [1, 4, 24]
const AGE_LABELS = ["<1h", "1–4h", "4–24h", ">24h"]

/** Bucket open-conversation ages (hours since last activity) into aging buckets. */
export function bucketBacklogAging(ageHours: number[]): BacklogAging {
  const counts = new Array(AGE_LABELS.length).fill(0) as number[]
  let oldest = 0
  for (const h of ageHours) {
    if (h > oldest) oldest = h
    let idx = AGE_EDGES.findIndex((e) => h < e)
    if (idx < 0) idx = AGE_EDGES.length
    counts[idx]++
  }
  return {
    buckets: AGE_LABELS.map((label, i) => ({ label, count: counts[i] })),
    total: ageHours.length,
    oldestHours: ageHours.length ? round1(oldest) : null,
  }
}

/* ── Section 5 — per-platform conversation breakdown (all channels, incl. email/SMS) ── */

/** A `socialConversation.groupBy({ by: ["platform","status"] })` row. */
export interface ConvPlatformRow {
  platform: string
  status: string
  _count: { _all: number }
}

export interface PlatformStat {
  platform: string
  total: number
  open: number
  resolved: number
}

/** Fold (channel, status) counts into a per-channel open/resolved breakdown. The `platform`
 *  field carries the RESOLVED channel: social channels store their channel as `platform`;
 *  email/sms/web-chat are bucketed under platform "inbox" with the real channel in
 *  `metadata.channel` (see ensureConversation), so the route resolves it via
 *  COALESCE(NULLIF(platform,'inbox'), metadata->>'channel') before handing rows here. */
export function summarizeConversationPlatforms(rows: ConvPlatformRow[]): PlatformStat[] {
  const map = new Map<string, PlatformStat>()
  for (const r of rows) {
    const c = r._count?._all ?? 0
    if (c <= 0) continue
    const e = map.get(r.platform) ?? { platform: r.platform, total: 0, open: 0, resolved: 0 }
    e.total += c
    if (r.status === "open") e.open += c
    else if (r.status === "resolved") e.resolved += c
    map.set(r.platform, e)
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.platform.localeCompare(b.platform))
}
