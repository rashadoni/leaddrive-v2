import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { isAdmin } from "@/lib/permissions"
import { approvalRulesSchema, readApprovalRules, DEFAULT_APPROVERS } from "@/lib/procurement/approval"
import { badRequest, readJsonBody } from "@/lib/procurement/access"

/**
 * Approval bands of purchase orders (task 3.4), in `settings.procurement`.
 * Everyone in purchasing reads them — the order card shows who is next — and
 * only an administrator changes them.
 */
export const GET = withRlsAuth("procurement", "read", async (_req, { orgId }) => {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } })
  const people = await prisma.user.findMany({
    where: { organizationId: orgId, isActive: true, role: { notIn: ["reviewer"] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  })
  return NextResponse.json({ success: true, data: { approvalRules: readApprovalRules(org?.settings), defaultApprovers: DEFAULT_APPROVERS, people } })
})

const putSchema = z.object({ approvalRules: approvalRulesSchema }).strict()

export const PUT = withRlsAuth("procurement", "write", async (req, { orgId, userId, role }) => {
  if (!isAdmin(role)) return NextResponse.json({ error: "Only an administrator sets approval limits" }, { status: 403 })
  const read = await readJsonBody(req)
  if (!read.ok) return read.response
  const parsed = putSchema.safeParse(read.body)
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message || "Invalid input", "INVALID_RULES")
  const named = parsed.data.approvalRules.flatMap((rule) => rule.approvers.flatMap((approver) => ("userId" in approver ? [approver.userId] : [])))
  if (named.length > 0) {
    const found = await prisma.user.count({ where: { organizationId: orgId, id: { in: [...new Set(named)] }, isActive: true } })
    if (found !== new Set(named).size) return badRequest("An approver is not a person of this organization", "UNKNOWN_USER")
  }
  const rules = [...parsed.data.approvalRules].sort((a, b) => a.minAmount - b.minAmount)
  await prisma.$transaction(async (tx) => {
    // Other settings live in the same JSON; the row lock keeps a parallel save of them.
    await tx.$queryRaw`SELECT "id" FROM "organizations" WHERE "id" = ${orgId} FOR UPDATE`
    const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } })
    const settings = (org.settings && typeof org.settings === "object" ? org.settings : {}) as Record<string, unknown>
    const procurement = (settings.procurement && typeof settings.procurement === "object" ? settings.procurement : {}) as Record<string, unknown>
    await tx.organization.update({
      where: { id: orgId },
      data: { settings: { ...settings, procurement: { ...procurement, approvalRules: rules } } as Prisma.InputJsonValue },
    })
  })
  logAudit(orgId, "update", "settings", orgId, "procurement.approvalRules", { newValue: rules, userId })
  return NextResponse.json({ success: true, data: { approvalRules: rules } })
})
