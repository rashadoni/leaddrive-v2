/**
 * Platform-event definition registry — N14 Phase 5 slice 1.
 *
 *   POST /api/v1/platform-events/definitions  — create event type
 *   GET  /api/v1/platform-events/definitions  — list tenant types
 *
 * The fields blob is double-validated: Zod shape-check at the API
 * boundary + engine's parseFieldSpecs at the persistence boundary
 * (same belt-and-suspenders pattern as H3 / N6).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { parseFieldSpecs } from "@/lib/platform-events/payload-validator"

const fieldSpecSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z_][a-z0-9_]*$/i, "name must be a valid identifier"),
  type: z.enum(["string", "number", "boolean", "timestamp", "json"]),
  required: z.boolean(),
  maxLength: z.number().int().positive().max(50_000).optional(),
})

const createSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z_][a-z0-9_]*$/i, "name must be a valid identifier"),
  description: z.string().max(2000).optional(),
  fields: z.array(fieldSpecSchema).min(1).max(40),
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

export const POST = withRlsAuth("settings", "write", async (req: NextRequest, auth) => {
  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Defensive double-parse — same idiom as H3/N6 to keep one runtime
  // source of truth for field shape between API + sandbox callers.
  try {
    parseFieldSpecs(parsed.data.fields)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid fields" },
      { status: 400 }
    )
  }

  let created
  try {
    created = await prisma.platformEventDefinition.create({
      data: {
        organizationId: auth.orgId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        fields: parsed.data.fields as unknown as Prisma.InputJsonValue,
        createdBy: auth.userId,
      },
      select: {
        id: true,
        name: true,
        description: true,
        fields: true,
        isActive: true,
        createdAt: true,
      },
    })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `A platform event with name "${parsed.data.name}" already exists in this tenant` },
        { status: 409 }
      )
    }
    throw e
  }

  return NextResponse.json({ definition: created }, { status: 201 })
})

export const GET = withRlsAuth("settings", "read", async (_req: NextRequest, auth) => {
  const definitions = await prisma.platformEventDefinition.findMany({
    where: { organizationId: auth.orgId },
    select: {
      id: true,
      name: true,
      description: true,
      fields: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    // TODO(slice 2): paginate via cursor (`updatedAt + id`) so a
    // tenant with > 500 definitions doesn't silently lose rows in
    // the list. Pair with the subscriber endpoint's pagination
    // semantics so the UI uses one cursor convention.
    take: 500,
  })

  return NextResponse.json({ definitions })
})
