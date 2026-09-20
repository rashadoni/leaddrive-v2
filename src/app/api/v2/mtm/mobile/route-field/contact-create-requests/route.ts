import { z } from "zod"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withMobileRls } from "@/lib/with-mobile-rls"
import { requireMobilePermission } from "@/lib/mtm/mobile-capabilities"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { contactRequestHash, rankContactDuplicates } from "@/lib/mtm/contact-create-request"

const bodySchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  displayName: z.string().trim().min(2).max(160),
  specialtyName: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(64).nullable().optional(),
  clinicName: z.string().trim().min(2).max(200),
  address: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

const duplicateSelect = { id: true, displayName: true, specialtyName: true, phone: true } as const

/**
 * The agent's own requests, newest first.
 *
 * Until now a request left the phone and vanished: the field app had no way
 * to say whether a manager had approved the doctor, asked for more or turned
 * it down, and the agent's only signal was the doctor quietly appearing in
 * their list days later — or never. Scope is the agent themselves; a request
 * belongs to whoever filed it.
 */
export const GET = withMobileRls(async (req, auth) => {
  const permission = requireMobilePermission(auth, "ROUTE_EXECUTE")
  if (permission) return permission
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor?.agentId || actor.role !== "AGENT" || actor.agentId !== auth.agentId) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" }, { status: 403 })
  }
  // `Number(null)` is 0, not NaN: without the explicit "absent" case a request
  // with no `limit` asked for one row.
  const limitParam = new URL(req.url).searchParams.get("limit")
  const requested = limitParam === null ? Number.NaN : Number(limitParam)
  const limit = Number.isFinite(requested) && requested >= 1 ? Math.min(50, Math.floor(requested)) : 20
  const requests = await prisma.mtmContactCreateRequest.findMany({
    where: { organizationId: auth.orgId, requestedByAgentId: actor.agentId },
    orderBy: { submittedAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      displayName: true,
      specialtyName: true,
      clinicName: true,
      phone: true,
      decisionComment: true,
      submittedAt: true,
      reviewedAt: true,
      approvedContactId: true,
      approvedCustomerId: true,
    },
  })
  return NextResponse.json({ success: true, data: { requests } })
}, { requiredCapability: "route-field" })

export const POST = withMobileRls(async (req, auth) => {
  const permission = requireMobilePermission(auth, "ROUTE_EXECUTE")
  if (permission) return permission
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor?.agentId || actor.role !== "AGENT" || actor.agentId !== auth.agentId) {
    return NextResponse.json({ error: "Forbidden", code: "MTM_ROUTE_FIELD_AGENT_REQUIRED" }, { status: 403 })
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request" }, { status: 400 })
  }
  const body = parsed.data
  const normalized = {
    displayName: body.displayName,
    specialtyName: body.specialtyName || null,
    phone: body.phone || null,
    clinicName: body.clinicName,
    address: body.address || null,
    notes: body.notes || null,
  }
  const requestHash = contactRequestHash(normalized)
  const existing = await prisma.mtmContactCreateRequest.findFirst({
    where: { organizationId: auth.orgId, idempotencyKey: body.idempotencyKey },
    include: { approvedContact: { select: { id: true, displayName: true } } },
  })
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return NextResponse.json({ error: "Idempotency key was reused", code: "MTM_CONTACT_CREATE_IDEMPOTENCY_MISMATCH" }, { status: 409 })
    }
    return NextResponse.json({ success: true, data: existing, idempotent: true })
  }

  const pool = await prisma.mtmContact.findMany({
    where: { organizationId: auth.orgId, deletedAt: null },
    select: duplicateSelect,
    orderBy: { updatedAt: "desc" },
    take: 5000,
  })
  const duplicates = rankContactDuplicates(normalized, pool)
  const created = await prisma.mtmContactCreateRequest.create({
    data: {
      organizationId: auth.orgId,
      requestedByAgentId: actor.agentId,
      idempotencyKey: body.idempotencyKey,
      requestHash,
      ...normalized,
      duplicateSnapshot: duplicates,
    },
  })
  return NextResponse.json({ success: true, data: { ...created, duplicateCandidates: duplicates } }, { status: 201 })
}, { requiredCapability: "route-field" })
