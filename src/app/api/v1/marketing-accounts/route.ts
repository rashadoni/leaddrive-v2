/**
 * C5 Account Engagement — MarketingAccount create (Phase 1).
 *
 * POST /api/v1/marketing-accounts
 *   Promote a CRM Company:  { companyId: string, icpTier?: IcpTier }
 *   Manual create:          { accountName, industrySlug?, employeeBand?,
 *                             annualRevenueUsd?, icpTier? }
 *
 * The promote path maps the Company's demographics onto the account and
 * auto-computes the fit grade via `calculateAccountGrade` + the tenant's
 * grade weights. The manual path takes explicit fields. In BOTH paths the
 * grade is recomputed server-side — never trusted from the client.
 *
 * Tenant-scoped. RBAC: account-engagement:write. One MarketingAccount per
 * (org, companyId) — re-promoting a company returns 409.
 *
 * NOTE: there is no DB unique constraint on (organizationId, companyId)
 * yet, so the 409 check is best-effort against a concurrent double-promote.
 * A partial unique index is a recommended follow-up (see
 * memory/deferred_findings.md).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { buildAccountFromCompany, slugifyIndustry } from "@/lib/account-engagement/promote-company"
import { loadAccountGradeWeights } from "@/lib/account-engagement/config-loader"
import { calculateAccountGrade } from "@/lib/account-engagement/account-grade-calculator"
import {
  ICP_TIERS,
  EMPLOYEE_BANDS,
  type IcpTier,
  type EmployeeBand,
} from "@/lib/account-engagement/types"

const TABLE = "marketing_accounts"
const MAX_NAME_LEN = 200

const SELECT_ACCOUNT = {
  id: true,
  accountName: true,
  companyId: true,
  lifecycleStage: true,
  icpTier: true,
  grade: true,
  engagementScore: true,
  industrySlug: true,
  employeeBand: true,
  annualRevenueUsd: true,
  ownerUserId: true,
  lastSignalAt: true,
  createdAt: true,
  updatedAt: true,
} as const

/** annualRevenueUsd is a BigInt — NextResponse.json cannot serialize it. */
function serializeAccount<T extends { annualRevenueUsd: bigint | null }>(a: T) {
  return {
    ...a,
    annualRevenueUsd: a.annualRevenueUsd != null ? a.annualRevenueUsd.toString() : null,
  }
}

function isIcpTier(v: unknown): v is IcpTier {
  return typeof v === "string" && (ICP_TIERS as readonly string[]).includes(v)
}
function isEmployeeBand(v: unknown): v is EmployeeBand {
  return typeof v === "string" && (EMPLOYEE_BANDS as readonly string[]).includes(v)
}

interface CreateBody {
  companyId?: unknown
  accountName?: unknown
  industrySlug?: unknown
  employeeBand?: unknown
  annualRevenueUsd?: unknown
  icpTier?: unknown
}

export const POST = withRlsAuth(
  "account-engagement",
  "write",
  async (req: NextRequest, auth) => {
    const orgId = auth.orgId

    let body: CreateBody
    try {
      body = (await req.json()) as CreateBody
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    // icpTier (optional) — shared by both paths.
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

    const weights = await loadAccountGradeWeights(orgId)

    try {
      /* ── Promote path ───────────────────────────────────────────── */
      const companyId =
        typeof body.companyId === "string" ? body.companyId.trim() : ""
      if (companyId) {
        const company = await prisma.company.findFirst({
          where: { id: companyId, organizationId: orgId },
          select: {
            id: true,
            name: true,
            industry: true,
            employeeCount: true,
            annualRevenue: true,
          },
        })
        if (!company) {
          return NextResponse.json(
            { error: "Company not found for this tenant" },
            { status: 404 },
          )
        }

        const existing = await prisma.marketingAccount.findFirst({
          where: { organizationId: orgId, companyId },
          select: { id: true },
        })
        if (existing) {
          return NextResponse.json(
            {
              error: "Company is already promoted to a marketing account",
              accountId: existing.id,
            },
            { status: 409 },
          )
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

        const account = await prisma.marketingAccount.create({
          data: {
            organizationId: orgId,
            companyId,
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
          },
          select: SELECT_ACCOUNT,
        })

        void recordPiiAccessFromRequest(req, auth, {
          recordTable: TABLE,
          recordId: account.id,
          action: "write",
          metadata: { promotedFrom: companyId, grade: account.grade },
        })

        return NextResponse.json(
          { account: serializeAccount(account) },
          { status: 201 },
        )
      }

      /* ── Manual path ────────────────────────────────────────────── */
      const accountName =
        typeof body.accountName === "string"
          ? body.accountName.trim().slice(0, MAX_NAME_LEN)
          : ""
      if (!accountName) {
        return NextResponse.json(
          { error: "`accountName` or `companyId` is required" },
          { status: 400 },
        )
      }

      let employeeBand: EmployeeBand | null = null
      if (body.employeeBand !== undefined && body.employeeBand !== null) {
        if (!isEmployeeBand(body.employeeBand)) {
          return NextResponse.json(
            { error: `Invalid \`employeeBand\` — one of: ${EMPLOYEE_BANDS.join(", ")}` },
            { status: 400 },
          )
        }
        employeeBand = body.employeeBand
      }

      // Normalise through the same slugifier the promote path uses, so a
      // manual "Food & Beverage" matches the tenant's target-industry slugs.
      const industrySlug =
        typeof body.industrySlug === "string"
          ? slugifyIndustry(body.industrySlug)
          : null

      let annualRevenueUsd: bigint | null = null
      let revenueNum: number | null = null
      if (body.annualRevenueUsd !== undefined && body.annualRevenueUsd !== null) {
        const n = Number(body.annualRevenueUsd)
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json(
            { error: "`annualRevenueUsd` must be a non-negative number" },
            { status: 400 },
          )
        }
        revenueNum = n
        annualRevenueUsd = BigInt(Math.round(n))
      }

      const graded = calculateAccountGrade({
        icpTier,
        employeeBand,
        industrySlug,
        targetIndustries: weights.targetIndustries,
        disqualifiedIndustries: weights.disqualifiedIndustries,
        annualRevenueUsd: revenueNum,
      })
      const grade = graded.ok ? graded.breakdown.grade : "unassigned"

      const account = await prisma.marketingAccount.create({
        data: {
          organizationId: orgId,
          companyId: null,
          accountName,
          lifecycleStage: "target",
          icpTier,
          grade,
          engagementScore: 0,
          industrySlug,
          employeeBand,
          annualRevenueUsd,
          ownerUserId: auth.userId ?? null,
          metadata: {
            gradeRationale: graded.ok ? graded.breakdown.rationale : "",
            promotedFrom: "manual",
          } as Prisma.InputJsonValue,
        },
        select: SELECT_ACCOUNT,
      })

      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: account.id,
        action: "write",
        metadata: { promotedFrom: "manual", grade: account.grade },
      })

      return NextResponse.json(
        { account: serializeAccount(account) },
        { status: 201 },
      )
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2003") {
          return NextResponse.json(
            { error: "Invalid foreign key (`companyId`)" },
            { status: 400 },
          )
        }
      }
      console.error("[marketing-accounts] POST error:", err)
      return NextResponse.json(
        { error: "Failed to create marketing account" },
        { status: 500 },
      )
    }
  },
)
