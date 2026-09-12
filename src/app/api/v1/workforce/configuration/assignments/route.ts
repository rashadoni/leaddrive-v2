import { NextRequest, NextResponse } from "next/server"
import { getMtmSettings } from "@/lib/mtm-settings"
import { currentDateKey, isDateKey } from "@/lib/mtm/mobile-week"
import { prisma } from "@/lib/prisma"
import { isValidTimezone } from "@/lib/timezone"
import { withWorkforceSessionAdminAuth } from "@/lib/with-workforce-rls-auth"
import {
  WorkforceConfigurationManagementError,
  WorkforceShiftAssignmentScheduleSchema,
  scheduleWorkforceShiftAssignment,
} from "@/lib/workforce/configuration-management"
import { workforceConfigurationRequestAuditContext } from "@/lib/workforce/configuration-route"

const assignmentSelect = {
  id: true,
  agentId: true,
  templateId: true,
  effectiveFrom: true,
  effectiveTo: true,
  assignedByUserId: true,
  createdAt: true,
  updatedAt: true,
  // Preserve display labels with historical timeline rows. A person or shift
  // can later be deactivated, but an HR administrator must still be able to
  // understand an effective-dated assignment without typing an opaque ID.
  agent: {
    select: {
      id: true,
      name: true,
      email: true,
      externalCode: true,
      teamId: true,
      status: true,
      team: { select: { id: true, name: true, code: true, isActive: true } },
    },
  },
  template: {
    select: {
      id: true,
      code: true,
      name: true,
      timezone: true,
      teamId: true,
      status: true,
      isDefault: true,
    },
  },
} as const

const rosterEmployeeSelect = {
  id: true,
  name: true,
  email: true,
  externalCode: true,
  teamId: true,
  status: true,
  team: { select: { id: true, name: true, code: true, isActive: true } },
} as const

const rosterTeamSelect = {
  id: true,
  name: true,
  code: true,
  isActive: true,
} as const

const rosterTemplateSelect = {
  id: true,
  code: true,
  name: true,
  timezone: true,
  teamId: true,
  isDefault: true,
} as const

const ROSTER_SEARCH_LIMIT = 200
const ROSTER_SEARCH_QUERY_MAX_LENGTH = 100

/** Read-only administrative timeline; employees cannot select their own shift. */
export const GET = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const effectiveDate = req.nextUrl.searchParams.get("effectiveDate")
  if (effectiveDate !== null && !isDateKey(effectiveDate)) {
    return NextResponse.json({ error: "effectiveDate must be a real YYYY-MM-DD date" }, { status: 400 })
  }

  // Configuration can be used by a large tenant. Keep the picker bounded and
  // tell the browser when it needs a narrower named search instead of silently
  // loading or truncating the active employee roster.
  const rosterQuery = (req.nextUrl.searchParams.get("rosterQuery") ?? "").trim()
  if (rosterQuery.length > ROSTER_SEARCH_QUERY_MAX_LENGTH) {
    return NextResponse.json({ error: `rosterQuery must be at most ${ROSTER_SEARCH_QUERY_MAX_LENGTH} characters` }, { status: 400 })
  }
  const rosterLimitRaw = req.nextUrl.searchParams.get("rosterLimit")
  const rosterLimit = rosterLimitRaw === null ? ROSTER_SEARCH_LIMIT : Number(rosterLimitRaw)
  if (!Number.isSafeInteger(rosterLimit) || rosterLimit < 1 || rosterLimit > ROSTER_SEARCH_LIMIT) {
    return NextResponse.json({ error: `rosterLimit must be a whole number from 1 to ${ROSTER_SEARCH_LIMIT}` }, { status: 400 })
  }
  const rosterWhere = {
    organizationId: auth.orgId,
    status: "ACTIVE" as const,
    ...(rosterQuery
      ? {
          OR: [
            { name: { contains: rosterQuery, mode: "insensitive" as const } },
            { email: { contains: rosterQuery, mode: "insensitive" as const } },
            { externalCode: { contains: rosterQuery, mode: "insensitive" as const } },
          ],
        }
      : {}),
  }

  try {
    const previewAt = effectiveDate ? new Date(`${effectiveDate}T00:00:00.000Z`) : null
    const [assignments, rosterMatches, directoryEmployees, teams, shiftTemplates, effectiveAssignments] = await Promise.all([
      prisma.workforceShiftAssignment.findMany({
        where: { organizationId: auth.orgId },
        orderBy: [{ agent: { name: "asc" } }, { effectiveFrom: "asc" }, { id: "asc" }],
        select: assignmentSelect,
      }),
      prisma.mtmAgent.findMany({
        where: rosterWhere,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: rosterLimit + 1,
        select: rosterEmployeeSelect,
      }),
      prisma.mtmAgent.findMany({
        where: { organizationId: auth.orgId },
        orderBy: [{ status: "asc" }, { name: "asc" }, { id: "asc" }],
        take: 250,
        select: rosterEmployeeSelect,
      }),
      prisma.mtmTeam.findMany({
        where: { organizationId: auth.orgId },
        orderBy: [{ isActive: "desc" }, { name: "asc" }, { id: "asc" }],
        select: rosterTeamSelect,
      }),
      prisma.workforceShiftTemplate.findMany({
        where: { organizationId: auth.orgId, status: "ACTIVE" },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: rosterTemplateSelect,
      }),
      previewAt
        ? prisma.workforceShiftAssignment.findMany({
            where: {
              organizationId: auth.orgId,
              effectiveFrom: { lte: previewAt },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: previewAt } }],
            },
            orderBy: [{ agent: { name: "asc" } }, { id: "asc" }],
            select: assignmentSelect,
          })
        : Promise.resolve([]),
    ])
    const hasMoreRosterEmployees = rosterMatches.length > rosterLimit
    const employees = rosterMatches.slice(0, rosterLimit)
    return NextResponse.json({
      success: true,
      data: {
        assignments,
        // These are named, tenant-scoped picker records. The web client may
        // display an inactive team for historical context, but the write
        // service remains the authority for future-effective eligibility.
        roster: {
          employees,
          teams,
          shiftTemplates,
          query: rosterQuery,
          limit: rosterLimit,
          hasMore: hasMoreRosterEmployees,
        },
        directoryEmployees,
        // This is a direct-assignment preview only. Team/organization default
        // resolution stays server-side; its future versioning is WF-C3-007.
        preview: previewAt ? { effectiveDate, assignments: effectiveAssignments } : null,
      },
    })
  } catch (error) {
    console.error("[workforce/configuration/assignments GET]", error)
    return NextResponse.json({ error: "Failed to load Workforce shift assignments" }, { status: 500 })
  }
})

/**
 * Writes only a future effective-dated assignment. The organization date is
 * derived server-side so a browser cannot schedule into its own past/today.
 */
export const POST = withWorkforceSessionAdminAuth(async (req: NextRequest, auth) => {
  const parsed = WorkforceShiftAssignmentScheduleSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid Workforce shift assignment" }, { status: 400 })
  }
  try {
    const settings = await getMtmSettings(auth.orgId)
    const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
    const assignment = await scheduleWorkforceShiftAssignment({
      organizationId: auth.orgId,
      assignment: parsed.data,
      currentDateKey: currentDateKey(new Date(), timezone),
      audit: workforceConfigurationRequestAuditContext(req, auth.userId),
    })
    return NextResponse.json({ success: true, data: { assignment } }, { status: 201 })
  } catch (error) {
    if (error instanceof WorkforceConfigurationManagementError) {
      const status = error.code === "WORKFORCE_CONFIGURATION_ASSIGNMENT_AGENT_NOT_FOUND"
        || error.code === "WORKFORCE_CONFIGURATION_ASSIGNMENT_TEMPLATE_NOT_FOUND"
        ? 404
        : 409
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    console.error("[workforce/configuration/assignments POST]", error)
    return NextResponse.json({ error: "Failed to schedule Workforce shift assignment" }, { status: 500 })
  }
})
