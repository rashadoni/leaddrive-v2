/**
 * UnifiedProfile builder — G1/G3 Phase 6 Block B slice 2-3 (the write-path).
 *
 * Wires the pure slice-1 helpers (identity-keys → profile-merger →
 * profile-aggregator) to Prisma so UnifiedProfile / ProfileSource /
 * ProfileMergeCandidate rows actually get materialized. Until this existed,
 * `GET /api/v1/calculated-insights` always returned 0 profiles because nothing
 * populated the table.
 *
 * Two phases, both idempotent (safe to re-run — the cron run doubles as backfill):
 *
 *   Phase A — INGEST (`resolveCandidate`): for every source record (Contact /
 *   Lead / MtmCustomer / WebChatSession) normalize identity → decideMerge against
 *   the tenant's existing profiles →
 *     • create_new  → mint UnifiedProfile
 *     • merge_into  → reuse the matched profile
 *     • ambiguous   → record a ProfileMergeCandidate (email→A, phone→B) for the
 *                     /cdp/merge-queue operator, attach the source to the
 *                     lexicographically-smaller profile so it still aggregates
 *     • reject      → no email AND no phone → skip
 *   then upsert a ProfileSource row (unique on org+sourceType+sourceId).
 *
 *   Phase B — AGGREGATE (`aggregateProfiles`): recompute the materialized columns
 *   from each profile's sources + paid invoices via aggregateProfile(), and stamp
 *   lastRefreshedAt. Full recompute (not incremental) — correct + idempotent.
 *
 * Two entry points share both phases:
 *   • buildProfilesForOrg  — every source in a tenant (cron + backfill).
 *   • refreshProfileForSource — one source (real-time write-hooks), scoped
 *     aggregation of just the affected profile.
 *
 * The builder takes an injected client (structural subset of PrismaClient) so
 * it unit-tests without a live DB — same DI pattern as loyalty/expiry-cron.
 */
import { normalizeIdentity } from "./identity-keys"
import { decideMerge } from "./profile-merger"
import { aggregateProfile } from "./profile-aggregator"
import type {
  AggregatorInvoiceRow,
  AggregatorSourceRow,
  ProfileSourceType,
} from "./types"
import { decimalToNumber } from "@/lib/prisma-decimal"
import {
  buildInvoiceLinkMaps,
  linkIds,
  resolveInvoiceProfileId,
} from "./invoice-link"

/**
 * Phone-normalization country hint + currency fallback. The tenant footprint is
 * AZ-headquartered (see identity-keys COUNTRY_DIAL_CODES) and every money column
 * in the schema defaults to AZN. Slice-3 may read these from Organization config.
 */
const DEFAULT_COUNTRY = "AZ"
const DEFAULT_CURRENCY = "AZN"

/* ─── Injected client (structural subset of PrismaClient) ──────────────────── */

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ProfileBuilderClient {
  contact: { findMany: (args: any) => Promise<any[]> }
  lead: { findMany: (args: any) => Promise<any[]> }
  mtmCustomer: { findMany: (args: any) => Promise<any[]> }
  webChatSession: { findMany: (args: any) => Promise<any[]> }
  invoice: { findMany: (args: any) => Promise<any[]> }
  unifiedProfile: {
    findMany: (args: any) => Promise<any[]>
    create: (args: any) => Promise<{ id: string }>
    update: (args: any) => Promise<any>
  }
  profileSource: {
    upsert: (args: any) => Promise<any>
  }
  profileMergeCandidate: {
    findFirst: (args: any) => Promise<any | null>
    create: (args: any) => Promise<any>
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ─── Internal candidate shape ─────────────────────────────────────────────── */

interface SourceCandidate {
  sourceType: ProfileSourceType
  sourceId: string
  email: string | null
  phone: string | null
  name: string | null
  firstSeenAt: Date | null
  lastSeenAt: Date | null
  /** Loose FK used to attach paid invoices during aggregation. */
  contactId: string | null
  companyId: string | null
}

export interface BuildResult {
  profilesCreated: number
  profilesUpdated: number
  sourcesLinked: number
  mergeCandidates: number
  rejected: number
}

function emptyResult(): BuildResult {
  return { profilesCreated: 0, profilesUpdated: 0, sourcesLinked: 0, mergeCandidates: 0, rejected: 0 }
}

export interface RefreshResult {
  action: "created" | "merged" | "ambiguous" | "rejected" | "source_not_found"
  profileId: string | null
}

/* ─── Row → candidate mappers (single source of truth for each source type) ──── */
/* eslint-disable @typescript-eslint/no-explicit-any */

const CONTACT_SELECT = { id: true, fullName: true, email: true, phone: true, companyId: true, createdAt: true, updatedAt: true }
const LEAD_SELECT = { id: true, contactName: true, email: true, phone: true, createdAt: true, updatedAt: true }
const MTM_SELECT = { id: true, name: true, phone: true, createdAt: true, updatedAt: true }
const WEBCHAT_SELECT = { id: true, visitorName: true, visitorEmail: true, visitorPhone: true, createdAt: true, lastMessageAt: true }

function mapContactRow(c: any): SourceCandidate {
  return {
    sourceType: "contact",
    sourceId: c.id,
    email: c.email ?? null,
    phone: c.phone ?? null,
    name: c.fullName ?? null,
    firstSeenAt: c.createdAt ?? null,
    lastSeenAt: c.updatedAt ?? null,
    contactId: c.id,
    companyId: c.companyId ?? null,
  }
}

function mapLeadRow(l: any): SourceCandidate {
  return {
    sourceType: "lead",
    sourceId: l.id,
    email: l.email ?? null,
    phone: l.phone ?? null,
    name: l.contactName ?? null,
    firstSeenAt: l.createdAt ?? null,
    lastSeenAt: l.updatedAt ?? null,
    // Leads aren't CRM contacts (companyName is free text, no FK) → no invoice link.
    contactId: null,
    companyId: null,
  }
}

function mapMtmRow(m: any): SourceCandidate {
  return {
    sourceType: "mtm_customer",
    sourceId: m.id,
    email: null, // MtmCustomer has no email column — phone-only identity
    phone: m.phone ?? null,
    name: m.name ?? null,
    firstSeenAt: m.createdAt ?? null,
    lastSeenAt: m.updatedAt ?? null,
    contactId: null,
    companyId: null,
  }
}

function mapWebChatRow(w: any): SourceCandidate {
  return {
    sourceType: "web_chat_session",
    sourceId: w.id,
    email: w.visitorEmail ?? null,
    phone: w.visitorPhone ?? null,
    name: w.visitorName ?? null,
    firstSeenAt: w.createdAt ?? null,
    lastSeenAt: w.lastMessageAt ?? null,
    // contactId intentionally NULL. A session's profile is decided by its VISITOR
    // identity, not its linked CRM contact (`WebChatSession.contactId`). Using that
    // FK as primaryContactId could mis-attribute the contact's invoices to a
    // visitor-identity profile AND clobber the real contact's entry in the
    // contact→profile map. The contact's invoices flow through its OWN source.
    contactId: null,
    companyId: null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ─── Phase A: collect all candidates / load one candidate ─────────────────── */

async function collectAllCandidates(
  client: ProfileBuilderClient,
  orgId: string,
): Promise<SourceCandidate[]> {
  // Deterministic order: each source group is id-sorted, groups concatenated in a
  // fixed order. A contact + a lead sharing an email resolve the same way every
  // run (contact first → created, lead → merged into it).
  const [contacts, leads, mtm, web] = await Promise.all([
    client.contact.findMany({ where: { organizationId: orgId }, orderBy: { id: "asc" }, select: CONTACT_SELECT }),
    client.lead.findMany({ where: { organizationId: orgId }, orderBy: { id: "asc" }, select: LEAD_SELECT }),
    client.mtmCustomer.findMany({ where: { organizationId: orgId, deletedAt: null }, orderBy: { id: "asc" }, select: MTM_SELECT }),
    client.webChatSession.findMany({ where: { organizationId: orgId }, orderBy: { id: "asc" }, select: WEBCHAT_SELECT }),
  ])
  return [
    ...contacts.map(mapContactRow),
    ...leads.map(mapLeadRow),
    ...mtm.map(mapMtmRow),
    ...web.map(mapWebChatRow),
  ]
}

/** Load a single source record by (type, id) → candidate, or null if not found. */
async function loadCandidate(
  client: ProfileBuilderClient,
  orgId: string,
  sourceType: ProfileSourceType,
  sourceId: string,
): Promise<SourceCandidate | null> {
  switch (sourceType) {
    case "contact": {
      const r = await client.contact.findMany({ where: { id: sourceId, organizationId: orgId }, select: CONTACT_SELECT, take: 1 })
      return r[0] ? mapContactRow(r[0]) : null
    }
    case "lead": {
      const r = await client.lead.findMany({ where: { id: sourceId, organizationId: orgId }, select: LEAD_SELECT, take: 1 })
      return r[0] ? mapLeadRow(r[0]) : null
    }
    case "mtm_customer": {
      const r = await client.mtmCustomer.findMany({ where: { id: sourceId, organizationId: orgId, deletedAt: null }, select: MTM_SELECT, take: 1 })
      return r[0] ? mapMtmRow(r[0]) : null
    }
    case "web_chat_session": {
      const r = await client.webChatSession.findMany({ where: { id: sourceId, organizationId: orgId }, select: WEBCHAT_SELECT, take: 1 })
      return r[0] ? mapWebChatRow(r[0]) : null
    }
    default:
      return null
  }
}

type ExistingProfile = { id: string; emailNormalized: string | null; phoneNormalized: string | null }

/**
 * Resolve ONE candidate: normalize → decideMerge → create / merge / ambiguous /
 * reject → upsert ProfileSource. Mutates `result` counters and `existing` (pushes
 * a freshly-created profile so later candidates in the same run match it).
 * Returns the action + the profile the source landed on (null when rejected).
 */
async function resolveCandidate(
  client: ProfileBuilderClient,
  orgId: string,
  cand: SourceCandidate,
  existing: ExistingProfile[],
  now: Date,
  result: BuildResult,
): Promise<RefreshResult> {
  const identity = normalizeIdentity({
    email: cand.email,
    phone: cand.phone,
    name: cand.name,
    defaultCountry: DEFAULT_COUNTRY,
  })
  const decision = decideMerge({
    candidate: { identity, sourceType: cand.sourceType, sourceId: cand.sourceId },
    existing,
  })

  if (decision.action === "reject") {
    result.rejected++
    return { action: "rejected", profileId: null }
  }

  let targetProfileId: string
  let action: RefreshResult["action"]

  if (decision.action === "create_new") {
    const created = await client.unifiedProfile.create({
      data: {
        organizationId: orgId,
        emailNormalized: identity.emailNormalized,
        phoneNormalized: identity.phoneNormalized,
        nameNormalized: identity.nameNormalized,
        displayEmail: cand.email,
        displayPhone: cand.phone,
        displayName: cand.name,
        primaryContactId: cand.contactId,
        primaryCompanyId: cand.companyId,
        primaryCurrency: DEFAULT_CURRENCY,
      },
      select: { id: true },
    })
    targetProfileId = created.id
    action = "created"
    result.profilesCreated++
    // Keep the in-memory set current so LATER candidates in this same run
    // match this fresh profile instead of minting a duplicate.
    existing.push({
      id: created.id,
      emailNormalized: identity.emailNormalized,
      phoneNormalized: identity.phoneNormalized,
    })
  } else if (decision.action === "merge_into") {
    targetProfileId = decision.targetProfileId
    action = "merged"
  } else {
    // ambiguous — email matches one profile, phone another. Surface to the
    // operator queue; attach the source to the canonical (smaller id) profile
    // so its activity still aggregates somewhere until the operator resolves.
    const [x, y] = decision.candidateProfileIds
    const primaryProfileId = x < y ? x : y
    const secondaryProfileId = x < y ? y : x
    // No unique constraint on the pair → find-then-create for idempotency.
    const pending = await client.profileMergeCandidate.findFirst({
      where: { organizationId: orgId, primaryProfileId, secondaryProfileId, status: "pending" },
      select: { id: true },
    })
    if (!pending) {
      await client.profileMergeCandidate.create({
        data: {
          organizationId: orgId,
          primaryProfileId,
          secondaryProfileId,
          // Exact email+phone collision across two profiles — top score.
          score: 1,
          matchBreakdown: { email: 1, phone: 1, source: `${cand.sourceType}/${cand.sourceId}` },
          reason: decision.reason,
          status: "pending",
        },
      })
      result.mergeCandidates++
    }
    targetProfileId = primaryProfileId
    action = "ambiguous"
  }

  // Attach the source (idempotent on org+sourceType+sourceId).
  await client.profileSource.upsert({
    where: {
      organizationId_sourceType_sourceId: {
        organizationId: orgId,
        sourceType: cand.sourceType,
        sourceId: cand.sourceId,
      },
    },
    create: {
      organizationId: orgId,
      unifiedProfileId: targetProfileId,
      sourceType: cand.sourceType,
      sourceId: cand.sourceId,
      confidence: 1,
      lastContributedAt: now,
    },
    update: { unifiedProfileId: targetProfileId, lastContributedAt: now },
  })
  result.sourcesLinked++

  return { action, profileId: targetProfileId }
}

/* ─── Public entry point: full tenant build (cron + backfill) ──────────────── */

/**
 * Build + refresh every UnifiedProfile for one tenant. Idempotent: re-running
 * never duplicates profiles or sources, and converges the aggregates.
 */
export async function buildProfilesForOrg(
  client: ProfileBuilderClient,
  orgId: string,
  opts?: { now?: Date },
): Promise<BuildResult> {
  const now = opts?.now ?? new Date()
  const result = emptyResult()

  // Existing profiles, deterministic order (merger determinism contract).
  const existing = (await client.unifiedProfile.findMany({
    where: { organizationId: orgId },
    select: { id: true, emailNormalized: true, phoneNormalized: true },
    orderBy: { id: "asc" },
  })) as ExistingProfile[]

  const candidates = await collectAllCandidates(client, orgId)

  // Phase A.
  for (const cand of candidates) {
    await resolveCandidate(client, orgId, cand, existing, now, result)
  }

  // Phase B — recompute every profile in the tenant.
  result.profilesUpdated = await aggregateProfiles(client, orgId, { now })

  return result
}

/* ─── Public entry point: single-source refresh (real-time write-hooks) ────── */

/**
 * Refresh exactly one source's profile — called fire-and-forget from the
 * contact / lead create routes and the invoice-paid path so a profile updates
 * immediately instead of waiting for the next cron. Scoped: re-aggregates only
 * the affected profile. Safe to call with a stale/deleted sourceId (returns
 * `source_not_found`). Never throws for a missing identity (returns `rejected`).
 */
export async function refreshProfileForSource(
  client: ProfileBuilderClient,
  orgId: string,
  sourceType: ProfileSourceType,
  sourceId: string,
  opts?: { now?: Date },
): Promise<RefreshResult> {
  const now = opts?.now ?? new Date()

  const cand = await loadCandidate(client, orgId, sourceType, sourceId)
  if (!cand) return { action: "source_not_found", profileId: null }

  const existing = (await client.unifiedProfile.findMany({
    where: { organizationId: orgId },
    select: { id: true, emailNormalized: true, phoneNormalized: true },
    orderBy: { id: "asc" },
  })) as ExistingProfile[]

  const resolved = await resolveCandidate(client, orgId, cand, existing, now, emptyResult())
  if (!resolved.profileId) return resolved // rejected

  // Re-aggregate just the affected profile.
  await aggregateProfiles(client, orgId, { profileIds: [resolved.profileId], now })
  return resolved
}

/**
 * Re-aggregate ONE profile's materialized columns (totalSpent / lifetimeOrderCount /
 * channelsActive / seen-dates / primaryCurrency) from its CURRENT sources + paid
 * invoices. Used after a merge-queue resolution folds a secondary profile's sources
 * into the primary, so the primary's rollups reflect the combined set.
 */
export async function reaggregateProfile(
  client: ProfileBuilderClient,
  orgId: string,
  profileId: string,
  opts?: { now?: Date },
): Promise<number> {
  return aggregateProfiles(client, orgId, { profileIds: [profileId], now: opts?.now ?? new Date() })
}

/* ─── Phase B: aggregation ─────────────────────────────────────────────────── */

/**
 * Load first/last-seen timestamps for the given sources, keyed `type:id`. Reuses
 * the row→candidate mappers so the timestamp semantics never drift from Phase A.
 */
async function loadSourceTimestamps(
  client: ProfileBuilderClient,
  orgId: string,
  sources: ReadonlyArray<{ sourceType: string; sourceId: string }>,
): Promise<Map<string, { firstSeenAt: Date | null; lastSeenAt: Date | null }>> {
  const ids: Record<ProfileSourceType, string[]> = {
    contact: [],
    lead: [],
    mtm_customer: [],
    portal_user: [],
    web_chat_session: [],
  }
  for (const s of sources) {
    if (s.sourceType in ids) ids[s.sourceType as ProfileSourceType].push(s.sourceId)
  }

  const ts = new Map<string, { firstSeenAt: Date | null; lastSeenAt: Date | null }>()
  const add = (cands: SourceCandidate[]) => {
    for (const c of cands) ts.set(`${c.sourceType}:${c.sourceId}`, { firstSeenAt: c.firstSeenAt, lastSeenAt: c.lastSeenAt })
  }

  const queries: Array<Promise<void>> = []
  if (ids.contact.length) {
    queries.push(client.contact.findMany({ where: { organizationId: orgId, id: { in: ids.contact } }, select: CONTACT_SELECT }).then((r) => add(r.map(mapContactRow))))
  }
  if (ids.lead.length) {
    queries.push(client.lead.findMany({ where: { organizationId: orgId, id: { in: ids.lead } }, select: LEAD_SELECT }).then((r) => add(r.map(mapLeadRow))))
  }
  if (ids.mtm_customer.length) {
    queries.push(client.mtmCustomer.findMany({ where: { organizationId: orgId, id: { in: ids.mtm_customer } }, select: MTM_SELECT }).then((r) => add(r.map(mapMtmRow))))
  }
  if (ids.web_chat_session.length) {
    queries.push(client.webChatSession.findMany({ where: { organizationId: orgId, id: { in: ids.web_chat_session } }, select: WEBCHAT_SELECT }).then((r) => add(r.map(mapWebChatRow))))
  }
  await Promise.all(queries)
  return ts
}

/**
 * Recompute totalSpent / lifetimeOrderCount / first-last-seen / channelsActive /
 * primaryCurrency for the given profiles (all in the tenant when `profileIds`
 * omitted) and stamp lastRefreshedAt. Returns the number updated.
 */
async function aggregateProfiles(
  client: ProfileBuilderClient,
  orgId: string,
  opts: { profileIds?: string[]; now: Date },
): Promise<number> {
  const now = opts.now
  const profiles = (await client.unifiedProfile.findMany({
    where: { organizationId: orgId, ...(opts.profileIds ? { id: { in: opts.profileIds } } : {}) },
    select: {
      id: true,
      primaryContactId: true,
      primaryCompanyId: true,
      primaryCurrency: true,
      metadata: true,
      sources: { select: { sourceType: true, sourceId: true } },
    },
  })) as Array<{
    id: string
    primaryContactId: string | null
    primaryCompanyId: string | null
    primaryCurrency: string | null
    metadata: unknown
    sources: Array<{ sourceType: string; sourceId: string }>
  }>

  if (profiles.length === 0) return 0

  // Per-source first/last-seen (re-loaded from the source tables; reuses the
  // Phase-A mappers so the timestamp semantics can't drift).
  const tsBySource = await loadSourceTimestamps(client, orgId, profiles.flatMap((p) => p.sources))

  // Paid invoices, linked via contact / company. buildInvoiceLinkMaps unions
  // primaryContactId with EVERY contact-type source (P2 fix), shared with the
  // read route so the two paths attribute spend identically.
  const maps = buildInvoiceLinkMaps(profiles)
  const { contactIds, companyIds } = linkIds(maps)

  const orFilters: Array<{ contactId?: { in: string[] }; companyId?: { in: string[] } }> = []
  if (contactIds.length > 0) orFilters.push({ contactId: { in: contactIds } })
  if (companyIds.length > 0) orFilters.push({ companyId: { in: companyIds } })

  const invoices: Array<{ contactId: string | null; companyId: string | null; totalAmount: unknown; currency: string }> =
    orFilters.length === 0
      ? []
      : await client.invoice.findMany({
          where: { organizationId: orgId, status: "paid", paidAt: { not: null }, OR: orFilters },
          select: { contactId: true, companyId: true, totalAmount: true, currency: true },
        })

  const invoicesByProfile = new Map<string, Array<{ amount: number; currency: string }>>()
  for (const inv of invoices) {
    const profileId = resolveInvoiceProfileId(inv, maps)
    if (!profileId) continue
    const amount = decimalToNumber(inv.totalAmount)
    if (!Number.isFinite(amount)) continue
    const arr = invoicesByProfile.get(profileId) ?? []
    arr.push({ amount, currency: inv.currency })
    invoicesByProfile.set(profileId, arr)
  }

  let updated = 0
  for (const p of profiles) {
    const profileInvoices = invoicesByProfile.get(p.id) ?? []

    // primaryCurrency = the currency carrying the most paid spend (so the bulk of
    // revenue lands in totalSpent and only minority currencies spill into
    // crossCurrencyTotals). Fall back to the stored value, then AZN.
    const primaryCurrency = dominantCurrency(profileInvoices) ?? p.primaryCurrency ?? DEFAULT_CURRENCY

    const sources: AggregatorSourceRow[] = p.sources.map((s) => {
      const ts = tsBySource.get(`${s.sourceType}:${s.sourceId}`)
      return {
        sourceType: s.sourceType as ProfileSourceType,
        firstSeenAt: ts?.firstSeenAt ?? null,
        lastSeenAt: ts?.lastSeenAt ?? null,
      }
    })

    const aggInvoices: AggregatorInvoiceRow[] = profileInvoices.map((i) => ({
      totalAmount: i.amount,
      currency: i.currency,
      status: "paid",
    }))

    const agg = aggregateProfile({ sources, invoices: aggInvoices, primaryCurrency })

    await client.unifiedProfile.update({
      where: { id: p.id },
      data: {
        totalSpent: agg.totalSpent,
        lifetimeOrderCount: agg.lifetimeOrderCount,
        firstSeenAt: agg.firstSeenAt,
        lastSeenAt: agg.lastSeenAt,
        channelsActive: agg.channelsActive as string[],
        primaryCurrency,
        // Read-merge: preserve any other keys a future writer (G4 segmentation /
        // ProfileInsight) may put in metadata; only (over)write crossCurrencyTotals.
        metadata: {
          ...(p.metadata && typeof p.metadata === "object" && !Array.isArray(p.metadata)
            ? (p.metadata as Record<string, unknown>)
            : {}),
          crossCurrencyTotals: agg.crossCurrencyTotals,
        },
        lastRefreshedAt: now,
      },
    })
    updated++
  }

  return updated
}

/** Currency carrying the largest summed paid amount, or null when no invoices. */
function dominantCurrency(invoices: Array<{ amount: number; currency: string }>): string | null {
  if (invoices.length === 0) return null
  const totals = new Map<string, number>()
  for (const i of invoices) {
    totals.set(i.currency, (totals.get(i.currency) ?? 0) + i.amount)
  }
  let best: string | null = null
  let bestTotal = -Infinity
  // Iterate in insertion order but break ties deterministically by currency code.
  for (const [currency, total] of totals) {
    if (total > bestTotal || (total === bestTotal && best !== null && currency < best)) {
      best = currency
      bestTotal = total
    }
  }
  return best
}
