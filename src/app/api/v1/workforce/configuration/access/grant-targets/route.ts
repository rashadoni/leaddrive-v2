import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withWorkforceSessionGrantManagementAuth } from "@/lib/with-workforce-rls-auth"
import { requireWorkforceAccessGrantRateLimit } from "@/lib/workforce/access-grant-rate-limit"
import { requireWorkforceAttendanceSecurityMfa } from "@/lib/workforce/attendance-route"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"
import { logWorkforceSensitiveOperationFailure } from "@/lib/workforce/sensitive-operation-log"
import {
  applyWorkforceSensitiveResponseHeaders,
  workforceSensitiveResponseHeaders,
} from "@/lib/workforce/sensitive-response"

const TargetKind = z.enum(["PRINCIPAL", "TEAM", "SITE", "AGENT"])
const Query = z.string().trim().min(2).max(80)
const TARGET_LIMIT = 25

type GrantTarget = {
  id: string
  label: string
}

function unavailable(): NextResponse {
  return NextResponse.json({
    error: "Unable to load Workforce grant targets.",
    code: "WORKFORCE_ACCESS_GRANT_TARGET_SEARCH_UNAVAILABLE",
  }, { status: 503, headers: workforceSensitiveResponseHeaders })
}

function invalid(): NextResponse {
  return NextResponse.json({
    error: "Search requires a target kind and at least two characters.",
    code: "WORKFORCE_ACCESS_GRANT_TARGET_SEARCH_INVALID",
  }, { status: 400, headers: workforceSensitiveResponseHeaders })
}

/**
 * GET /api/v1/workforce/configuration/access/grant-targets
 *
 * A narrow type-ahead source for the MFA-gated C7 role manager. It never
 * offers a complete tenant directory or cross-tenant identity oracle: the
 * caller must provide a short query, active rows are capped at 25, and only
 * the opaque target ID plus an HR-facing display label is returned. The grant
 * writer remains the final tenant/status/scope authorization boundary.
 */
export const GET = withWorkforceSessionGrantManagementAuth(async (req: NextRequest, auth) => {
  const mfaDenied = await requireWorkforceAttendanceSecurityMfa(auth.orgId, auth)
  if (mfaDenied) return applyWorkforceSensitiveResponseHeaders(mfaDenied)

  const { searchParams } = new URL(req.url)
  const parsedKind = TargetKind.safeParse(searchParams.get("kind"))
  const parsedQuery = Query.safeParse(searchParams.get("q"))
  if (!parsedKind.success || !parsedQuery.success) return invalid()

  const rateLimited = await requireWorkforceAccessGrantRateLimit({
    operation: "INVENTORY",
    organizationId: auth.orgId,
    principalUserId: auth.userId,
  })
  if (rateLimited) return rateLimited

  try {
    const contains = { contains: parsedQuery.data, mode: "insensitive" as const }
    let targets: GrantTarget[]
    switch (parsedKind.data) {
      case "PRINCIPAL": {
        const users = await prisma.user.findMany({
          where: {
            organizationId: auth.orgId,
            isActive: true,
            OR: [{ name: contains }, { email: contains }],
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: TARGET_LIMIT + 1,
          select: { id: true, name: true, email: true },
        })
        targets = users.map((user) => ({ id: user.id, label: user.name + " · " + user.email }))
        break
      }
      case "TEAM": {
        const teams = await prisma.mtmTeam.findMany({
          where: {
            organizationId: auth.orgId,
            isActive: true,
            OR: [{ name: contains }, { code: contains }],
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: TARGET_LIMIT + 1,
          select: { id: true, name: true, code: true },
        })
        targets = teams.map((team) => ({
          id: team.id,
          label: team.code ? team.name + " · " + team.code : team.name,
        }))
        break
      }
      case "SITE": {
        const sites = await prisma.workforceSite.findMany({
          where: {
            organizationId: auth.orgId,
            status: "ACTIVE",
            OR: [{ name: contains }, { code: contains }],
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: TARGET_LIMIT + 1,
          select: { id: true, name: true, code: true },
        })
        targets = sites.map((site) => ({ id: site.id, label: site.name + " · " + site.code }))
        break
      }
      case "AGENT": {
        const agents = await prisma.mtmAgent.findMany({
          where: {
            organizationId: auth.orgId,
            status: "ACTIVE",
            OR: [{ name: contains }, { email: contains }, { externalCode: contains }],
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: TARGET_LIMIT + 1,
          select: { id: true, name: true, email: true, externalCode: true },
        })
        targets = agents.map((agent) => ({
          id: agent.id,
          label: [agent.name, agent.externalCode ?? agent.email].filter(Boolean).join(" · "),
        }))
        break
      }
    }
    const hasMore = targets.length > TARGET_LIMIT
    const result = targets.slice(0, TARGET_LIMIT)
    const requestAudit = workforceConfigurationRequestAuditContext(req, auth.userId)
    await prisma.mtmAuditLog.create({
      data: {
        organizationId: auth.orgId,
        agentId: null,
        action: "WORKFORCE_ACCESS_GRANT_TARGET_SEARCHED",
        entity: "workforce_access_grant_target",
        entityId: parsedKind.data,
        metadataKind: "workforce_access_control",
        // Keep names/search terms and internal target IDs out of the durable
        // access audit; counts are enough to account for this sensitive lookup.
        newData: {
          targetKind: parsedKind.data,
          queryLength: parsedQuery.data.length,
          resultCount: result.length,
          hasMore,
        },
        ipAddress: requestAudit.ipAddress,
        userAgent: requestAudit.userAgent,
      },
    })
    return NextResponse.json({
      success: true,
      data: { kind: parsedKind.data, items: result, hasMore },
    }, { headers: workforceSensitiveResponseHeaders })
  } catch {
    logWorkforceSensitiveOperationFailure({ operation: "configuration-access-grant-target-search" })
    return unavailable()
  }
})
