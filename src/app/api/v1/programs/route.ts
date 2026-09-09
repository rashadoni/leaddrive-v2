/**
 * Program registry — R9 Phase 5 slice 1.
 *
 *   POST /api/v1/programs  — create a funded program
 *   GET  /api/v1/programs  — list tenant programs (filter by status)
 *
 * Donations + grants reference programs via FK; deleting a program
 * leaves dependent rows with `programId: null` (general fund) per
 * the schema's SET NULL.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const createSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    status: z.enum(["planning", "active", "completed", "paused"]).optional(),
    goalAmount: z.number().min(0).optional(),
    goalCurrency: z.string().length(3).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.startsAt && d.endsAt && new Date(d.endsAt) <= new Date(d.startsAt)) {
      ctx.addIssue({
        code: "custom",
        message: "endsAt must be strictly after startsAt",
        path: ["endsAt"],
      })
    }
  })

const statusFilterSchema = z
  .enum(["planning", "active", "completed", "paused"])
  .optional()

async function readBody(req: NextRequest): Promise<unknown | NextResponse> {
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 })
  }
  if (raw.trim().length === 0) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
  }
}

export const POST = withRlsAuth("nonprofit", "write", async (req, auth) => {
  // `nonprofit` module — fundraising staff (sales/support roles) can
  // create programs without admin scope. Carve-out lives in
  // permissions.ts per the architect's L1+L2 / R4 follow-up patterns.

  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  let created
  try {
    created = await prisma.program.create({
      data: {
        organizationId: auth.orgId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        status: parsed.data.status ?? "active",
        goalAmount: parsed.data.goalAmount ?? 0,
        goalCurrency: parsed.data.goalCurrency ?? "USD",
        startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
        endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null,
        createdBy: auth.userId,
      },
    })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `A program with name "${parsed.data.name}" already exists in this tenant` },
        { status: 409 }
      )
    }
    throw e
  }

  return NextResponse.json({ program: created }, { status: 201 })
})

export const GET = withRlsAuth("nonprofit", "read", async (req, auth) => {
  const url = new URL(req.url)
  const statusRaw = url.searchParams.get("status")
  const statusParsed = statusFilterSchema.safeParse(statusRaw ?? undefined)
  if (!statusParsed.success) {
    const echo = (statusRaw ?? "").slice(0, 32)
    return NextResponse.json(
      { error: `Invalid status filter: "${echo}"` },
      { status: 400 }
    )
  }

  const programs = await prisma.program.findMany({
    where: {
      organizationId: auth.orgId,
      ...(statusParsed.data ? { status: statusParsed.data } : {}),
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    // TODO(slice 2): cursor pagination paired with the impact-reporting
    // dashboard's program-list view.
    take: 500,
  })

  return NextResponse.json({ programs })
})
