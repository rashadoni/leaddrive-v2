import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

// In-memory 5-minute cache per (orgId, entity) to avoid recomputing on every nav.
const CACHE_TTL_MS = 5 * 60 * 1000
interface Cached {
  expiresAt: number
  data: unknown
}
const cache = new Map<string, Cached>()

function cacheGet(key: string): unknown | null {
  const v = cache.get(key)
  if (!v) return null
  if (v.expiresAt < Date.now()) {
    cache.delete(key)
    return null
  }
  return v.data
}
function cachePut(key: string, data: unknown) {
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, data })
  if (cache.size > 500) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
}

type Entity = "contacts" | "leads"

async function aggregateContacts(orgId: string) {
  const where = { organizationId: orgId }
  const [total, active, withBrand, withCategory, bySource, byCategory, smsEver, sms30d, sms90d, newThis30, newPrev30, engagementAvg] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.count({ where: { ...where, isActive: true } }),
    prisma.contact.count({ where: { ...where, brand: { not: null } } }),
    prisma.contact.count({ where: { ...where, category: { not: null } } }),
    prisma.contact.groupBy({ by: ["source"], where, _count: true }),
    prisma.contact.groupBy({ by: ["category"], where, _count: true }),
    prisma.contact.count({ where: { ...where, lastSmsAt: { not: null } } }),
    prisma.contact.count({ where: { ...where, lastSmsAt: { gte: new Date(Date.now() - 30 * 86400_000) } } }),
    prisma.contact.count({ where: { ...where, lastSmsAt: { gte: new Date(Date.now() - 90 * 86400_000) } } }),
    prisma.contact.count({ where: { ...where, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } }),
    prisma.contact.count({
      where: {
        ...where,
        createdAt: {
          gte: new Date(Date.now() - 60 * 86400_000),
          lt: new Date(Date.now() - 30 * 86400_000),
        },
      },
    }),
    prisma.contact.aggregate({ where, _avg: { engagementScore: true } }),
  ])

  // Top brands (raw SQL is simpler for ORDER BY count DESC LIMIT)
  const topBrands = (await prisma.$queryRaw`
    SELECT "brand" AS brand, COUNT(*)::int AS count
    FROM "contacts"
    WHERE "organizationId" = ${orgId} AND "brand" IS NOT NULL AND "brand" <> ''
    GROUP BY "brand"
    ORDER BY count DESC
    LIMIT 10
  `) as Array<{ brand: string; count: number }>

  // 12-week timeseries (new contacts per week)
  const weekly = (await prisma.$queryRaw`
    SELECT
      date_trunc('week', "createdAt") AS week,
      COUNT(*)::int AS count
    FROM "contacts"
    WHERE "organizationId" = ${orgId}
      AND "createdAt" >= NOW() - INTERVAL '12 weeks'
    GROUP BY week
    ORDER BY week ASC
  `) as Array<{ week: Date; count: number }>

  // Engagement avg per category
  const engagementByCategory = (await prisma.$queryRaw`
    SELECT
      COALESCE("category", '(none)') AS category,
      AVG("engagementScore")::int AS avg_score,
      COUNT(*)::int AS count
    FROM "contacts"
    WHERE "organizationId" = ${orgId}
    GROUP BY category
    ORDER BY count DESC
  `) as Array<{ category: string; avg_score: number; count: number }>

  return {
    total,
    active,
    withBrand,
    withCategory,
    avgEngagement: Math.round(engagementAvg._avg.engagementScore ?? 0),
    growth: {
      last30: newThis30,
      prev30: newPrev30,
      pct: newPrev30 === 0 ? null : Math.round(((newThis30 - newPrev30) / newPrev30) * 100),
    },
    byCategory: byCategory.map((r: any) => ({ category: r.category || "(none)", count: r._count })),
    bySource: bySource.map((r: any) => ({ source: r.source || "(none)", count: r._count })),
    topBrands,
    sms: { everReceived: smsEver, last30: sms30d, last90: sms90d, coverage: total ? Math.round((smsEver / total) * 100) : 0 },
    weekly: weekly.map((r: any) => ({ week: r.week, count: r.count })),
    engagementByCategory,
  }
}

async function aggregateLeads(orgId: string) {
  const where = { organizationId: orgId }
  const [total, byCategory, bySource, byStatus, newThis30, newPrev30, scoreAvg] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.groupBy({ by: ["category"], where, _count: true }),
    prisma.lead.groupBy({ by: ["source"], where, _count: true }),
    prisma.lead.groupBy({ by: ["status"], where, _count: true }),
    prisma.lead.count({ where: { ...where, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } }),
    prisma.lead.count({
      where: {
        ...where,
        createdAt: {
          gte: new Date(Date.now() - 60 * 86400_000),
          lt: new Date(Date.now() - 30 * 86400_000),
        },
      },
    }),
    prisma.lead.aggregate({ where, _avg: { score: true } }),
  ])

  const topBrands = (await prisma.$queryRaw`
    SELECT "brand" AS brand, COUNT(*)::int AS count
    FROM "leads"
    WHERE "organizationId" = ${orgId} AND "brand" IS NOT NULL AND "brand" <> ''
    GROUP BY "brand"
    ORDER BY count DESC
    LIMIT 10
  `) as Array<{ brand: string; count: number }>

  const weekly = (await prisma.$queryRaw`
    SELECT
      date_trunc('week', "createdAt") AS week,
      COUNT(*)::int AS count
    FROM "leads"
    WHERE "organizationId" = ${orgId}
      AND "createdAt" >= NOW() - INTERVAL '12 weeks'
    GROUP BY week
    ORDER BY week ASC
  `) as Array<{ week: Date; count: number }>

  return {
    total,
    avgScore: Math.round(scoreAvg._avg.score ?? 0),
    growth: {
      last30: newThis30,
      prev30: newPrev30,
      pct: newPrev30 === 0 ? null : Math.round(((newThis30 - newPrev30) / newPrev30) * 100),
    },
    byCategory: byCategory.map((r: any) => ({ category: r.category || "(none)", count: r._count })),
    bySource: bySource.map((r: any) => ({ source: r.source || "(none)", count: r._count })),
    byStatus: byStatus.map((r: any) => ({ status: r.status, count: r._count })),
    topBrands,
    weekly: weekly.map((r: any) => ({ week: r.week, count: r.count })),
  }
}

export const GET = withRlsAuth("contacts", "read", async (req, auth) => {
  const orgId = auth.orgId
  const { searchParams } = new URL(req.url)
  const entity: Entity = searchParams.get("entity") === "leads" ? "leads" : "contacts"
  const noCache = searchParams.get("refresh") === "1"

  const cacheKey = `seg:${orgId}:${entity}`
  if (!noCache) {
    const cached = cacheGet(cacheKey)
    if (cached) return NextResponse.json({ success: true, data: cached, cached: true })
  }

  const data = entity === "leads" ? await aggregateLeads(orgId) : await aggregateContacts(orgId)
  cachePut(cacheKey, data)
  return NextResponse.json({ success: true, data, cached: false })
})
