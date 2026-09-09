/**
 * C5 Account Engagement — Phase 5: third-party intent feed.
 *
 * A vendor-agnostic seam (`ThirdPartyIntentProvider`) plus a working CSV
 * file-import provider as the interim filler — so the `third_party_intent`
 * SignalKind isn't dead until a PAID intent vendor (Bombora / 6sense /
 * Clearbit-Intent class) is chosen. A real vendor adapter implements the same
 * interface (fetchRows() calls the vendor API instead of parsing an upload) and
 * drops straight in — see memory/deferred_findings.md.
 *
 * Third-party intent is COMPANY-level (no contact): each row keys on a company
 * domain (or name) → resolved to a tracked MarketingAccount → an
 * AccountIntentSignal with signalKind "third_party_intent", contactId null.
 *
 * Pure helpers (normalizeDomain, parseIntentCsv) are unit-tested; the applier
 * takes an injectable Prisma client (mirrors config-loader / Phase 2).
 */
import { prisma as defaultPrisma } from "@/lib/prisma"
import { classifySignal } from "./intent-signal-classifier"

/** One third-party intent observation about a company. */
export interface ThirdPartyIntentRow {
  /** Company website/domain — primary match key (normalized). */
  companyDomain?: string | null
  /** Company name — fallback match key. */
  companyName?: string | null
  /** Intent topic / keyword cluster the vendor reports (e.g. "CRM software"). */
  topic: string
  /** Optional vendor intent score (0..100) — maps onto the signal weight. */
  intentScore?: number | null
  /** When the intent was observed. */
  observedAt: Date
}

/**
 * Vendor seam. The CSV file-import is one implementation; a real vendor adapter
 * implements the same contract with a live API call.
 */
export interface ThirdPartyIntentProvider {
  readonly providerName: string
  fetchRows(): Promise<ThirdPartyIntentRow[]>
}

/* ── Pure helpers ─────────────────────────────────────────────────────── */

/** Normalize a domain/URL to a bare host: lowercase, strip scheme/www/path/port. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null
  let s = input.trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "")
  s = s.split("/")[0].split("?")[0].split("#")[0].split(":")[0]
  return s || null
}

export interface ParseIntentCsvResult {
  rows: ThirdPartyIntentRow[]
  errors: string[]
}

const COLUMN_ALIASES: Record<string, keyof ThirdPartyIntentRow> = {
  domain: "companyDomain",
  website: "companyDomain",
  company_domain: "companyDomain",
  url: "companyDomain",
  company: "companyName",
  name: "companyName",
  company_name: "companyName",
  topic: "topic",
  keyword: "topic",
  intent_topic: "topic",
  score: "intentScore",
  intent_score: "intentScore",
  strength: "intentScore",
  date: "observedAt",
  observed_at: "observedAt",
  observed: "observedAt",
  timestamp: "observedAt",
}

/** Minimal CSV field splitter — handles double-quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ",") {
      out.push(cur)
      cur = ""
    } else {
      cur += c
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/**
 * Parse a third-party-intent CSV. Header-mapped (case-insensitive, alias-aware).
 * Returns parsed rows + per-line errors — never throws. Each row needs a domain
 * OR name, a topic, and (if present) a parseable date.
 */
export function parseIntentCsv(csv: string): ParseIntentCsvResult {
  const rows: ThirdPartyIntentRow[] = []
  const errors: string[] = []
  if (typeof csv !== "string" || !csv.trim()) return { rows, errors: ["empty CSV"] }

  const lines = csv.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) {
    return { rows, errors: ["CSV needs a header row + at least one data row"] }
  }

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"))
  const colMap = header.map((h) => COLUMN_ALIASES[h] ?? null)
  if (!colMap.includes("topic") || (!colMap.includes("companyDomain") && !colMap.includes("companyName"))) {
    return {
      rows,
      errors: [
        "CSV header must include a topic column and a domain/website or company/name column",
      ],
    }
  }

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i])
    const rec: Partial<Record<keyof ThirdPartyIntentRow, string>> = {}
    colMap.forEach((key, idx) => {
      if (key) rec[key] = cells[idx]
    })

    const companyDomain = normalizeDomain(rec.companyDomain ?? null)
    const companyName = rec.companyName?.trim() || null
    const topic = rec.topic?.trim() || ""
    if (!companyDomain && !companyName) {
      errors.push(`row ${i + 1}: missing company domain/name`)
      continue
    }
    if (!topic) {
      errors.push(`row ${i + 1}: missing topic`)
      continue
    }

    let observedAt = new Date()
    if (rec.observedAt) {
      const d = new Date(rec.observedAt)
      if (isNaN(d.getTime())) {
        errors.push(`row ${i + 1}: invalid date "${rec.observedAt}"`)
        continue
      }
      observedAt = d
    }

    let intentScore: number | null = null
    if (rec.intentScore) {
      const n = Number(rec.intentScore)
      if (Number.isFinite(n)) intentScore = n
    }

    rows.push({ companyDomain, companyName, topic, intentScore, observedAt })
  }
  return { rows, errors }
}

/** CSV-backed provider — demonstrates (and exercises) the vendor seam. */
export function createFileIntentProvider(csv: string): ThirdPartyIntentProvider {
  return {
    providerName: "file-import",
    async fetchRows() {
      return parseIntentCsv(csv).rows
    },
  }
}

/* ── Applier (injectable client) ──────────────────────────────────────── */

type IntentClient = {
  company: {
    findMany(args: {
      where: { organizationId: string }
      select: { id: true; name: true; website: true }
    }): Promise<{ id: string; name: string; website: string | null }[]>
  }
  marketingAccount: {
    findMany(args: {
      where: { organizationId: string }
      select: { id: true; companyId: true }
    }): Promise<{ id: string; companyId: string | null }[]>
    update(args: { where: { id: string }; data: { lastSignalAt: Date } }): Promise<unknown>
  }
  accountIntentSignal: {
    findFirst(args: {
      where: {
        organizationId: string
        marketingAccountId: string
        signalKind: string
        occurredAt: Date
        resourceRef: string
      }
      select: { id: true }
    }): Promise<{ id: string } | null>
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>
  }
}

export interface ApplyIntentResult {
  totalRows: number
  recorded: number
  duplicate: number
  noCompany: number
  notTracked: number
}

/**
 * Resolve each row's company → tracked MarketingAccount and record a
 * third_party_intent signal (contactId null, topic in resourceRef). Idempotent
 * per (account, kind, observedAt, topic). Bumps each touched account's
 * lastSignalAt to its newest observed signal. Tenant-scoped by orgId (and RLS
 * when called inside withRlsAuth).
 */
export async function applyThirdPartyIntentRows(
  orgId: string,
  rows: readonly ThirdPartyIntentRow[],
  client: IntentClient = defaultPrisma as unknown as IntentClient,
): Promise<ApplyIntentResult> {
  const result: ApplyIntentResult = {
    totalRows: rows.length,
    recorded: 0,
    duplicate: 0,
    noCompany: 0,
    notTracked: 0,
  }
  if (rows.length === 0) return result

  const cls = classifySignal({ signalKind: "third_party_intent" })
  const defaultWeight = cls.ok ? cls.classification.defaultWeight : 5

  const companies = await client.company.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, website: true },
  })
  const byDomain = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const c of companies) {
    const d = normalizeDomain(c.website)
    if (d && !byDomain.has(d)) byDomain.set(d, c.id)
    const n = c.name?.trim().toLowerCase()
    if (n && !byName.has(n)) byName.set(n, c.id)
  }

  const accounts = await client.marketingAccount.findMany({
    where: { organizationId: orgId },
    select: { id: true, companyId: true },
  })
  const accountByCompany = new Map<string, string>()
  for (const a of accounts) if (a.companyId) accountByCompany.set(a.companyId, a.id)

  const newestByAccount = new Map<string, Date>()

  for (const row of rows) {
    const companyId =
      (row.companyDomain ? byDomain.get(row.companyDomain) : undefined) ??
      (row.companyName ? byName.get(row.companyName.trim().toLowerCase()) : undefined) ??
      null
    if (!companyId) {
      result.noCompany++
      continue
    }
    const accountId = accountByCompany.get(companyId)
    if (!accountId) {
      result.notTracked++
      continue
    }

    const dup = await client.accountIntentSignal.findFirst({
      where: {
        organizationId: orgId,
        marketingAccountId: accountId,
        signalKind: "third_party_intent",
        occurredAt: row.observedAt,
        resourceRef: row.topic,
      },
      select: { id: true },
    })
    if (dup) {
      result.duplicate++
      continue
    }

    const weight =
      row.intentScore != null && Number.isFinite(row.intentScore)
        ? Math.min(100, Math.max(1, Math.round(row.intentScore)))
        : defaultWeight

    await client.accountIntentSignal.create({
      data: {
        organizationId: orgId,
        marketingAccountId: accountId,
        signalKind: "third_party_intent",
        weight,
        contactId: null,
        resourceRef: row.topic,
        occurredAt: row.observedAt,
        metadata: {
          provider: "file-import",
          topic: row.topic,
          intentScore: row.intentScore ?? null,
        },
      },
    })
    result.recorded++

    const prev = newestByAccount.get(accountId)
    if (!prev || row.observedAt > prev) newestByAccount.set(accountId, row.observedAt)
  }

  // Reflect the newest observed signal on each touched account.
  for (const [accountId, when] of newestByAccount) {
    await client.marketingAccount.update({
      where: { id: accountId },
      data: { lastSignalAt: when },
    })
  }

  return result
}
