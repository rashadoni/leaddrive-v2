/**
 * R2 Health — care plan roster / create (slice-2-mini).
 *
 * Thirteenth route-layer consumer of compliance-audit primitives.
 * Care plans carry per-row PHI (clinical goals + KPI history), so
 * every read/write logs via `recordPhiAccessFromRequest`.
 *
 * Status lifecycle (slice-1 `transitionCarePlan` helper):
 *   draft → active → paused | completed
 *   paused → active | cancelled
 *   draft/active/paused → cancelled (terminal)
 *
 * Goals payload is JSONB array; per-goal shape pre-validated by
 * slice-1 `validateCarePlanGoal` (exported from
 * `care-plan-progress-calculator.ts`). Without this pre-check the
 * downstream progress calculator would reject the row at compute
 * time instead of at write time.
 */
import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { recordPhiAccessFromRequest } from "@/lib/audit/compliance-audit"
import { validateCarePlanGoal } from "@/lib/health/care-plan-progress-calculator"
import { type CarePlanGoal } from "@/lib/health/types"
import { encryptForTenantOrNull } from "@/lib/crypto/tenant-pii-encryption"

const TABLE = "health_care_plans"
const MAX_PAGE_SIZE = 200
const MAX_NAME_LEN = 200
const MAX_DESCRIPTION_LEN = 10_000

function trimOrNull(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  if (!t) return null
  return t.slice(0, max)
}

function parseDate(v: unknown): Date | null | "invalid" {
  if (v === undefined || v === null) return null
  if (typeof v !== "string") return "invalid"
  const d = new Date(v)
  if (isNaN(d.getTime())) return "invalid"
  return d
}

interface GoalsValidationResult {
  ok: true
  goals: CarePlanGoal[]
}
interface GoalsValidationError {
  ok: false
  error: string
}
function validateGoalsArray(
  v: unknown,
): GoalsValidationResult | GoalsValidationError {
  if (v === undefined || v === null) return { ok: true, goals: [] }
  if (!Array.isArray(v)) {
    return { ok: false, error: "`goals` must be an array" }
  }
  if (v.length > 100) {
    return { ok: false, error: "`goals` array too long (max 100 entries)" }
  }
  const out: CarePlanGoal[] = []
  const seenIds = new Set<string>()
  for (let i = 0; i < v.length; i++) {
    const g = v[i] as Partial<CarePlanGoal> | unknown
    if (
      g === null ||
      typeof g !== "object" ||
      Array.isArray(g)
    ) {
      return { ok: false, error: `goal[${i}] must be a plain object` }
    }
    const goal = g as CarePlanGoal
    if (typeof goal.id !== "string" || goal.id.length === 0) {
      return { ok: false, error: `goal[${i}] missing \`id\`` }
    }
    if (seenIds.has(goal.id)) {
      return { ok: false, error: `goal[${i}] duplicate id "${goal.id}"` }
    }
    seenIds.add(goal.id)
    const v2 = validateCarePlanGoal(goal)
    if (!v2.ok) return { ok: false, error: v2.error }
    out.push(goal)
  }
  return { ok: true, goals: out }
}

export const GET = withRlsAuth("health", "read", async (req, auth) => {
  const orgId = auth.orgId

  const { searchParams } = new URL(req.url)
  const limitRaw = searchParams.get("limit")
  const cursor = searchParams.get("cursor")
  const status = searchParams.get("status")
  const patientId = searchParams.get("patientId")
  const providerId = searchParams.get("providerId")

  const limit = (() => {
    if (!limitRaw) return 50
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n <= 0) return 50
    return Math.min(n, MAX_PAGE_SIZE)
  })()

  const where: {
    organizationId: string
    status?: string
    patientId?: string
    providerId?: string
  } = { organizationId: orgId }
  if (status) where.status = status
  if (patientId) where.patientId = patientId
  if (providerId) where.providerId = providerId

  try {
    const plans = await prisma.healthCarePlan.findMany({
      where,
      orderBy: [{ startDate: "desc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        patientId: true,
        providerId: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        activatedAt: true,
        completedAt: true,
        cancelledAt: true,
        createdAt: true,
      },
    })
    const hasMore = plans.length > limit
    const rows = hasMore ? plans.slice(0, limit) : plans
    const nextCursor = hasMore ? rows[rows.length - 1].id : null

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: null,
      action: "read",
      metadata: {
        limit,
        cursor,
        status: status ?? null,
        patientId: patientId ?? null,
        providerId: providerId ?? null,
        rowCount: rows.length,
      },
    })

    return NextResponse.json({ plans: rows, hasMore, nextCursor })
  } catch (err) {
    console.error("[health-care-plans] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load care plans" },
      { status: 500 },
    )
  }
})

interface CreateBody {
  patientId?: unknown
  providerId?: unknown
  name?: unknown
  description?: unknown
  goals?: unknown
  startDate?: unknown
  endDate?: unknown
  metadata?: unknown
}

export const POST = withRlsAuth("health", "write", async (req, auth) => {
  const orgId = auth.orgId

  let body: CreateBody
  try {
    body = (await req.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const patientId = trimOrNull(body.patientId, 64)
  if (!patientId) {
    return NextResponse.json(
      { error: "`patientId` is required" },
      { status: 400 },
    )
  }
  const name = trimOrNull(body.name, MAX_NAME_LEN)
  if (!name) {
    return NextResponse.json(
      { error: "`name` is required" },
      { status: 400 },
    )
  }
  const startDate = parseDate(body.startDate)
  if (startDate === "invalid" || startDate === null) {
    return NextResponse.json(
      { error: "Valid `startDate` (ISO datetime) is required" },
      { status: 400 },
    )
  }
  const endDate = parseDate(body.endDate)
  if (endDate === "invalid") {
    return NextResponse.json(
      { error: "Invalid `endDate`" },
      { status: 400 },
    )
  }
  if (endDate && endDate.getTime() <= startDate.getTime()) {
    return NextResponse.json(
      { error: "`endDate` must be after `startDate`" },
      { status: 400 },
    )
  }

  const goalsResult = validateGoalsArray(body.goals)
  if (!goalsResult.ok) {
    return NextResponse.json(
      { error: `Invalid \`goals\`: ${goalsResult.error}` },
      { status: 400 },
    )
  }

  const providerId = trimOrNull(body.providerId, 64)

  // Tenant pre-check on patient + provider.
  const [patientCheck, providerCheck] = await Promise.all([
    prisma.healthPatient.findFirst({
      where: { id: patientId, organizationId: orgId },
      select: { id: true },
    }),
    providerId
      ? prisma.healthProvider.findFirst({
          where: { id: providerId, organizationId: orgId },
          select: { id: true },
        })
      : Promise.resolve(null),
  ])
  if (!patientCheck) {
    return NextResponse.json(
      { error: "Patient not found for this tenant" },
      { status: 404 },
    )
  }
  if (providerId && !providerCheck) {
    return NextResponse.json(
      { error: "Provider not found for this tenant" },
      { status: 404 },
    )
  }

  if (
    body.metadata !== undefined &&
    body.metadata !== null &&
    (typeof body.metadata !== "object" || Array.isArray(body.metadata))
  ) {
    return NextResponse.json(
      { error: "Invalid `metadata` — must be plain object" },
      { status: 400 },
    )
  }

  try {
    const plan = await prisma.healthCarePlan.create({
      data: {
        organizationId: orgId,
        patientId,
        providerId,
        name,
        // Slice-2 PII column wrap: care-plan description carries PHI
        // (treatment plan narrative). Encrypt at route boundary.
        description: encryptForTenantOrNull(
          orgId,
          trimOrNull(body.description, MAX_DESCRIPTION_LEN),
        ),
        goals: goalsResult.goals as unknown as Prisma.InputJsonValue,
        startDate,
        endDate,
        metadata: (body.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        patientId: true,
        providerId: true,
        name: true,
        status: true,
        startDate: true,
        endDate: true,
        createdAt: true,
      },
    })

    void recordPhiAccessFromRequest(req, auth, {
      recordTable: TABLE,
      recordId: plan.id,
      action: "write",
      metadata: {
        patientId: plan.patientId,
        providerId: plan.providerId,
        goalsCount: goalsResult.goals.length,
      },
    })

    return NextResponse.json({ plan }, { status: 201 })
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2003"
    ) {
      return NextResponse.json(
        { error: "Invalid foreign key (`patientId` / `providerId`)" },
        { status: 400 },
      )
    }
    console.error("[health-care-plans] POST error:", err)
    return NextResponse.json(
      { error: "Failed to create care plan" },
      { status: 500 },
    )
  }
})
