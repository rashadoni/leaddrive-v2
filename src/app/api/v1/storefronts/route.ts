/**
 * Storefront registry — D2 Phase 6 Block A slice 1.
 *
 *   POST /api/v1/storefronts  — create a storefront for the tenant
 *   GET  /api/v1/storefronts  — list (filter by isActive)
 *
 * Slice 1 ships admin-side CRUD only. Slice 2 wires public guest
 * endpoints (cart create + add-item by sessionToken) + the actual
 * Next.js (storefront) route group for the buyer-facing UI.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"

const createSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    // URL-safe identifier matching the DB CHECK exactly + forbid
    // consecutive separators (a--b / a__b / a-_b all rejected).
    .regex(/^[a-z0-9]$|^[a-z0-9][a-z0-9_-]*[a-z0-9]$/, "slug must be a URL-safe identifier")
    .refine(s => !/[-_]{2}/.test(s), {
      message: "slug must not contain consecutive separators (--, __, -_, _-)",
    }),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  primaryCurrency: z.string().length(3).optional(),
  primaryLocale: z.string().min(2).max(10).optional(),
  theme: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
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

export const POST = withRlsAuth("commerce", "write", async (req, auth) => {
  // `commerce:write` — same module used by D1 buyer accounts.
  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  let created
  try {
    created = await prisma.storefront.create({
      data: {
        organizationId: auth.orgId,
        slug: parsed.data.slug,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        primaryCurrency: parsed.data.primaryCurrency ?? "USD",
        primaryLocale: parsed.data.primaryLocale ?? "en-US",
        theme: (parsed.data.theme ?? {}) as unknown as Prisma.InputJsonValue,
        isActive: parsed.data.isActive ?? true,
        createdBy: auth.userId,
      },
    })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `A storefront with slug "${parsed.data.slug}" already exists in this tenant` },
        { status: 409 }
      )
    }
    throw e
  }

  return NextResponse.json({ storefront: created }, { status: 201 })
})

export const GET = withRlsAuth("commerce", "read", async (req, auth) => {
  const url = new URL(req.url)
  const isActiveRaw = url.searchParams.get("isActive")
  let isActiveFilter: boolean | undefined
  if (isActiveRaw === "true") isActiveFilter = true
  else if (isActiveRaw === "false") isActiveFilter = false
  else if (isActiveRaw != null) {
    return NextResponse.json(
      { error: `Invalid isActive filter: "${isActiveRaw.slice(0, 16)}" (expected "true" or "false")` },
      { status: 400 }
    )
  }

  const storefronts = await prisma.storefront.findMany({
    where: {
      organizationId: auth.orgId,
      ...(isActiveFilter !== undefined ? { isActive: isActiveFilter } : {}),
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    // TODO(slice 2): cursor pagination alongside the storefront admin UI.
    take: 500,
  })

  return NextResponse.json({ storefronts })
})
