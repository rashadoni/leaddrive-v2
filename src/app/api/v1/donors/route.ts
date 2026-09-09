/**
 * Donor registry — R9 Phase 5 slice 1.
 *
 *   POST /api/v1/donors  — register a donor
 *   GET  /api/v1/donors  — list (filter by donorType + tag)
 *
 * Slice 1 ships donor + program + donation routes; grant + volunteer
 * CRUD lands in slice 2 alongside the impact dashboard.
 *
 * Uniqueness on (orgId, email) is enforced by a PARTIAL unique
 * index — see migration SQL header. Donors without email can be
 * created freely; collision on duplicate email returns 409.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const createSchema = z.object({
  donorType: z.enum(["individual", "organization"]).optional(),
  name: z.string().min(1).max(200),
  email: z.string().email().max(200).optional(),
  phone: z.string().max(40).optional(),
  contactId: z.string().min(1).max(120).optional(),
  anonymous: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(64)).max(40).optional(),
  notes: z.string().max(4000).optional(),
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

export const POST = withRlsAuth("nonprofit", "write", async (req, auth) => {
  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Optional CRM contact link — verify it belongs to this tenant
  // before persisting, otherwise we'd let a caller link a donor to
  // a different tenant's contact (no FK enforces this).
  if (parsed.data.contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: parsed.data.contactId, organizationId: auth.orgId },
      select: { id: true },
    })
    if (!contact) {
      return NextResponse.json({ error: "Contact not found in tenant" }, { status: 404 })
    }
  }

  let created
  try {
    created = await prisma.donor.create({
      data: {
        organizationId: auth.orgId,
        donorType: parsed.data.donorType ?? "individual",
        name: parsed.data.name,
        email: parsed.data.email ?? null,
        phone: parsed.data.phone ?? null,
        contactId: parsed.data.contactId ?? null,
        anonymous: parsed.data.anonymous ?? false,
        tags: parsed.data.tags ?? [],
        notes: parsed.data.notes ?? null,
        createdBy: auth.userId,
      },
    })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      // Echo the email defensively-bounded — already capped at 200
      // by Zod, but mirror the GET route's slice() convention for
      // consistency.
      const echo = parsed.data.email?.slice(0, 200) ?? ""
      return NextResponse.json(
        { error: `A donor with email "${echo}" already exists in this tenant` },
        { status: 409 }
      )
    }
    throw e
  }

  return NextResponse.json({ donor: created }, { status: 201 })
})

const donorTypeFilterSchema = z.enum(["individual", "organization"]).optional()

export const GET = withRlsAuth("nonprofit", "read", async (req, auth) => {
  const url = new URL(req.url)
  const donorTypeRaw = url.searchParams.get("donorType")
  const donorTypeParsed = donorTypeFilterSchema.safeParse(donorTypeRaw ?? undefined)
  if (!donorTypeParsed.success) {
    const echo = (donorTypeRaw ?? "").slice(0, 32)
    return NextResponse.json(
      { error: `Invalid donorType filter: "${echo}"` },
      { status: 400 }
    )
  }

  const tag = url.searchParams.get("tag")

  const donors = await prisma.donor.findMany({
    where: {
      organizationId: auth.orgId,
      ...(donorTypeParsed.data ? { donorType: donorTypeParsed.data } : {}),
      ...(tag ? { tags: { has: tag } } : {}),
    },
    orderBy: { name: "asc" },
    // TODO(slice 2): cursor pagination paired with donor-stewardship dashboard.
    take: 500,
  })

  return NextResponse.json({ donors })
})
