/**
 * C5 Account Engagement — on-demand ICP/grade re-score ("recompute now").
 *
 * POST /api/v1/marketing-accounts/rescore
 *   Body: { accountId?: string }   (omit → rescore all the org's linked accounts)
 *
 * Re-derives icpTier + grade + firmographic fields for promoted accounts from
 * their linked CRM Company's CURRENT data (re-runs buildAccountFromCompany).
 * Closes the gap where accounts promoted before ICP auto-scoring — or before a
 * company profile was filled in — stay frozen at their promote-time values.
 *
 * Accounts with no companyId (manually created) are skipped. Tenant-scoped,
 * RBAC account-engagement:write. Engagement SCORE is unchanged here — that
 * comes from intent signals via the Phase-3 recompute; this is the fit side
 * (tier/grade), which is what goes stale when a company profile changes.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPiiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { buildAccountFromCompany } from "@/lib/account-engagement/promote-company"
import { loadAccountGradeWeights } from "@/lib/account-engagement/config-loader"

const TABLE = "marketing_accounts"
const MAX_ACCOUNTS = 500

type AccountRow = { id: string; companyId: string | null }
type CompanyRow = {
  id: string
  name: string
  industry: string | null
  employeeCount: number | null
  annualRevenue: number | null
}

export const POST = withRlsAuth(
  "account-engagement",
  "write",
  async (req: NextRequest, auth) => {
    const orgId = auth.orgId

    let body: { accountId?: unknown }
    try {
      body = (await req.json().catch(() => ({}))) as { accountId?: unknown }
    } catch {
      body = {}
    }
    const accountId = typeof body.accountId === "string" ? body.accountId.trim() : null

    try {
      const weights = await loadAccountGradeWeights(orgId)

      const accounts = (await prisma.marketingAccount.findMany({
        where: {
          organizationId: orgId,
          companyId: { not: null },
          ...(accountId ? { id: accountId } : {}),
        },
        select: { id: true, companyId: true },
        take: MAX_ACCOUNTS,
      })) as AccountRow[]

      if (accounts.length === 0) {
        return NextResponse.json({ rescored: 0, skipped: 0, results: [] }, { status: 200 })
      }

      const companyIds = accounts
        .map((a) => a.companyId)
        .filter((v): v is string => v != null)
      const companies = (await prisma.company.findMany({
        where: { id: { in: companyIds }, organizationId: orgId },
        select: { id: true, name: true, industry: true, employeeCount: true, annualRevenue: true },
      })) as CompanyRow[]
      const companyById = new Map(companies.map((c) => [c.id, c] as const))

      const results: Array<{ accountId: string; icpTier: string; grade: string }> = []
      let skipped = 0

      for (const acc of accounts) {
        const company = acc.companyId ? companyById.get(acc.companyId) : undefined
        if (!company) {
          skipped++
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
        )
        await prisma.marketingAccount.update({
          where: { id: acc.id },
          data: {
            icpTier: fields.icpTier,
            grade: fields.grade,
            employeeBand: fields.employeeBand,
            industrySlug: fields.industrySlug,
            annualRevenueUsd: fields.annualRevenueUsd,
          },
        })
        results.push({ accountId: acc.id, icpTier: fields.icpTier, grade: fields.grade })
      }

      void recordPiiAccessFromRequest(req, auth, {
        recordTable: TABLE,
        recordId: accountId,
        action: "write",
        metadata: { rescore: true, rescored: results.length, skipped },
      })

      return NextResponse.json(
        { rescored: results.length, skipped, results },
        { status: 200 },
      )
    } catch (err) {
      console.error("[marketing-accounts/rescore] POST error:", err instanceof Error ? err.message : "unknown")
      return NextResponse.json({ error: "Failed to rescore accounts" }, { status: 500 })
    }
  },
)
