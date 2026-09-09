/**
 * Donations — R9 Phase 5 slice 1.
 *
 *   POST /api/v1/donations  — record a single donation
 *   GET  /api/v1/donations  — list (filter by donor + date range)
 *
 * Tenant scoping enforced through Donor + Program FK lookups; the
 * route never trusts the body's organizationId.
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const createSchema = z
  .object({
    donorId: z.string().min(1).max(120),
    programId: z.string().min(1).max(120).optional(),
    amount: z.number().positive(),
    currency: z.string().length(3).default("USD"),
    receivedAt: z.string().datetime().optional(),
    donationType: z.enum(["one_time", "recurring"]).default("one_time"),
    isAnonymous: z.boolean().optional(),
    pledgedAmount: z.number().min(0).optional(),
    channel: z.enum(["card", "ach", "wire", "check", "cash", "in_kind"]).optional(),
    taxDeductibleAmount: z.number().min(0).optional(),
    notes: z.string().max(4000).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.taxDeductibleAmount != null && d.taxDeductibleAmount > d.amount) {
      ctx.addIssue({
        code: "custom",
        message: "taxDeductibleAmount cannot exceed amount",
        path: ["taxDeductibleAmount"],
      })
    }
  })

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

export const POST = withRlsAuth("nonprofit", "write", async (req: NextRequest, auth) => {
  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Verify donor + (optional) program belong to this tenant before
  // creating the donation. Defence-in-depth — the FK alone doesn't
  // enforce same-tenant.
  const donor = await prisma.donor.findFirst({
    where: { id: parsed.data.donorId, organizationId: auth.orgId },
    select: { id: true },
  })
  if (!donor) return NextResponse.json({ error: "Donor not found in tenant" }, { status: 404 })

  if (parsed.data.programId) {
    const program = await prisma.program.findFirst({
      where: { id: parsed.data.programId, organizationId: auth.orgId },
      select: { id: true },
    })
    if (!program) {
      return NextResponse.json({ error: "Program not found in tenant" }, { status: 404 })
    }
  }

  const created = await prisma.donation.create({
    data: {
      organizationId: auth.orgId,
      donorId: donor.id,
      programId: parsed.data.programId ?? null,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      receivedAt: parsed.data.receivedAt ? new Date(parsed.data.receivedAt) : new Date(),
      donationType: parsed.data.donationType,
      isAnonymous: parsed.data.isAnonymous ?? false,
      pledgedAmount: parsed.data.pledgedAmount ?? null,
      channel: parsed.data.channel ?? null,
      taxDeductibleAmount: parsed.data.taxDeductibleAmount ?? null,
      notes: parsed.data.notes ?? null,
      recordedBy: auth.userId,
    },
  })

  return NextResponse.json({ donation: created }, { status: 201 })
})

export const GET = withRlsAuth("nonprofit", "read", async (req: NextRequest, auth) => {
  const url = new URL(req.url)
  const donorId = url.searchParams.get("donorId")
  const programId = url.searchParams.get("programId")
  const sinceRaw = url.searchParams.get("since")
  const untilRaw = url.searchParams.get("until")

  let since: Date | undefined
  let until: Date | undefined
  if (sinceRaw) {
    const d = new Date(sinceRaw)
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "Invalid `since` date" }, { status: 400 })
    }
    since = d
  }
  if (untilRaw) {
    const d = new Date(untilRaw)
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "Invalid `until` date" }, { status: 400 })
    }
    until = d
  }

  const donations = await prisma.donation.findMany({
    where: {
      organizationId: auth.orgId,
      ...(donorId ? { donorId } : {}),
      ...(programId ? { programId } : {}),
      ...(since || until
        ? {
            receivedAt: {
              ...(since ? { gte: since } : {}),
              ...(until ? { lte: until } : {}),
            },
          }
        : {}),
    },
    orderBy: { receivedAt: "desc" },
    // TODO(slice 2): cursor pagination paired with donor-stewardship dashboard.
    take: 500,
  })

  return NextResponse.json({ donations })
})
