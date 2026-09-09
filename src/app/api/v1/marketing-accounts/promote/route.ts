/**
 * C5 Account Engagement — bulk promote CRM Companies → MarketingAccounts (Phase 1).
 *
 * POST /api/v1/marketing-accounts/promote
 *   Body: { companyIds: string[], icpTier?: IcpTier }   (1..200 ids)
 *
 * Promotes many Companies in one pass. Each company's grade is auto-computed
 * via `calculateAccountGrade` + the tenant's grade weights. Companies that
 * are already promoted (or appear twice in the input) are skipped, not
 * errored. Unknown / cross-tenant ids are reported as not_found. Returns a
 * per-company status summary.
 *
 * Tenant-scoped. RBAC: account-engagement:write. Score recompute is Phase 3;
 * promoted accounts start at engagementScore 0 until the recompute job runs.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { buildAccountFromCompany } from "@/lib/account-engagement/promote-company"
import { loadAccountGradeWeights } from "@/lib/account-engagement/config-loader"
import { ICP_TIERS, type IcpTier } from "@/lib/account-engagement/types"

const TABLE = "marketing_accounts"
const MAX_IDS = 200

function isIcpTier(v: unknown): v is IcpTier {
  return typeof v === "string" && (ICP_TIERS as readonly string[]).includes(v)
}

type PromoteStatus = "created" | "skipped" | "not_found"
interface PromoteResult {
  companyId: string
  status: PromoteStatus
  grade?: string
}

interface PromoteBody {
  companyIds?: unknown
  icpTier?: unknown
}

export const POST = withRlsAuth(
  "account-engagement",
  "write",
  async (req: NextRequest, auth) => {
    const orgId = auth.orgId

    let body: PromoteBody
    try {
      body = (await req.json()) as PromoteBody
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    if (!Array.isArray(body.companyIds) || body.companyIds.length === 0) {
      return NextResponse.json(
        { error: "`companyIds` must be a non-empty array" },
        { status: 400 },
      )
    }
    // Normalise + de-dupe while preserving input order.
    const seen = new Set<string>()
    const ids: string[] = []
    for (const raw of body.companyIds) {
      if (typeof raw !== "string") {
        return NextResponse.json(
          { error: "`companyIds` must contain only strings" },
          { status: 400 },
        )
      }
      const id = raw.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
      if (ids.length > MAX_IDS) {
        return NextResponse.json(
          { error: `Too many companyIds — max ${MAX_IDS} per request` },
          { status: 400 },
        )
      }
    }
    if (ids.length === 0) {
      return NextResponse.json(
        { error: "`companyIds` must contain at least one non-empty id" },
        { status: 400 },
      )
    }

    let icpTier: IcpTier = "unscored"
    if (body.icpTier !== undefined && body.icpTier !== null) {
      if (!isIcpTier(body.icpTier)) {
        return NextResponse.json(
          { error: `Invalid \`icpTier\` — one of: ${ICP_TIERS.join(", ")}` },
          { status: 400 },
        )
      }
      icpTier = body.icpTier
    }

    try {
      const weights = await loadAccountGradeWeights(orgId)

      // Explicit row types: this repo's local Prisma client degrades its
      // generic query-result types to `any` under the schema's size (a
      // repo-wide condition — committed routes hit the same TS7006), which
      // would make the `.map` callbacks implicitly-any. Annotating the
      // select results to the exact projected shape keeps this route
      // type-safe regardless of that degradation (identity in a healthy
      // env). Awaited sequentially — two round-trips on an admin bulk
      // action are negligible.
      type CompanyRow = {
        id: string
        name: string
        industry: string | null
        employeeCount: number | null
        annualRevenue: number | null
      }
      const companies = (await prisma.company.findMany({
        where: { id: { in: ids }, organizationId: orgId },
        select: {
          id: true,
          name: true,
          industry: true,
          employeeCount: true,
          annualRevenue: true,
        },
      })) as CompanyRow[]
      const alreadyPromoted = (await prisma.marketingAccount.findMany({
        where: { organizationId: orgId, companyId: { in: ids } },
        select: { companyId: true },
      })) as { companyId: string | null }[]

      const companyById = new Map(companies.map((c) => [c.id, c] as const))
      const promotedSet = new Set(
        alreadyPromoted
          .map((p) => p.companyId)
          .filter((v): v is string => v != null),
      )

      const toCreate: Prisma.MarketingAccountCreateManyInput[] = []
      const results: PromoteResult[] = []

      for (const id of ids) {
        const company = companyById.get(id)
        if (!company) {
          results.push({ companyId: id, status: "not_found" })
          continue
        }
        if (promotedSet.has(id)) {
          results.push({ companyId: id, status: "skipped" })
          continue
        }
        const fields = buildAccountFromCompany(
          {
            name: company.name,
            industry: company.industry,
            employeeCount: company.employeeCount,
            annualRevenue: company.annualRevenue,
          },
          weights,
          { icpTier },
        )
        toCreate.push({
          organizationId: orgId,
          companyId: id,
          accountName: fields.accountName,
          lifecycleStage: "target",
          icpTier: fields.icpTier,
          grade: fields.grade,
          engagementScore: 0,
          industrySlug: fields.industrySlug,
          employeeBand: fields.employeeBand,
          annualRevenueUsd: fields.annualRevenueUsd,
          ownerUserId: auth.userId ?? null,
          metadata: {
            gradeRationale: fields.gradeRationale,
            promotedFrom: "company",
          } as Prisma.InputJsonValue,
        })
        promotedSet.add(id) // guard against the same id surviving any future input path
        results.push({ companyId: id, status: "created", grade: fields.grade })
      }

      let created = 0
      if (toCreate.length > 0) {
        const r = await prisma.marketingAccount.createMany({ data: toCreate })
        created = r.count
      }

      const skipped = results.filter((r) => r.status === "skipped").length
      const notFound = results.filter((r) => r.status === "not_found").length

      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: null,
        action: "write",
        metadata: { bulkPromote: ids.length, created, skipped, notFound },
      })

      return NextResponse.json(
        { requested: ids.length, created, skipped, notFound, results },
        { status: created > 0 ? 201 : 200 },
      )
    } catch (err) {
      console.error("[marketing-accounts/promote] POST error:", err)
      return NextResponse.json(
        { error: "Failed to promote companies" },
        { status: 500 },
      )
    }
  },
)
