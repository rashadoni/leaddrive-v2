import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { getFieldPermissions, filterEntityFields } from "@/lib/field-filter"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { createLeadCommand } from "@/lib/crm-commands/lead/create-lead"

export const GET = withRlsAuth("leads", "read", async (req, auth) => {
  const { orgId, role, userId } = auth

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "50")

  const status = searchParams.get("status")
  const includeConverted = searchParams.get("includeConverted") === "true"

  try {
    let where: Prisma.LeadWhereInput = {
      organizationId: orgId,
      ...(search ? {
        OR: [
          { contactName: { contains: search, mode: "insensitive" as const } },
          { companyName: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      } : {}),
      ...(status ? { status } : includeConverted ? {} : { status: { not: "converted" } }),
    }

    where = await applyRecordFilter(orgId, userId, role, "lead", where)

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.lead.count({ where }),
    ])

    const fieldPerms = await getFieldPermissions(orgId, role, "lead")
    const assigneeIds = [...new Set(leads.map((lead) => lead.assignedTo).filter((id): id is string => Boolean(id)))]
    const assignees = assigneeIds.length
      ? await prisma.user.findMany({
          where: { id: { in: assigneeIds }, organizationId: orgId },
          select: { id: true, name: true, email: true },
        })
      : []
    const assigneeById = new Map(assignees.map((user) => [user.id, user.name || user.email]))
    const filteredLeads = leads.map((lead) => ({
      ...filterEntityFields(lead, fieldPerms, role),
      assignedToName: lead.assignedTo ? assigneeById.get(lead.assignedTo) ?? null : null,
    }))

    return NextResponse.json({ success: true, data: { leads: filteredLeads, total, page, limit } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withRlsAuth("leads", "write", async (req, auth) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  try {
    const result = await createLeadCommand(createRestActorContext({
      organizationId: auth.orgId,
      userId: auth.userId,
      role: auth.role,
      requestId: req.headers.get("x-request-id"),
    }), body)
    return NextResponse.json({ success: true, data: result.entity }, { status: 201 })
  } catch (error) {
    if (error instanceof CrmCommandError) {
      if (error.status === 403) {
        return NextResponse.json(
          { error: "Forbidden", message: error.message, code: error.code },
          { status: error.status },
        )
      }
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("[Leads POST]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
