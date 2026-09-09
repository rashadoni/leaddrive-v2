/**
 * Rollup-field registry — N6 Phase 4 slice 1.
 *
 *   POST /api/v1/rollup-fields  — create a rollup definition
 *   GET  /api/v1/rollup-fields  — list rollups for the tenant
 *
 * Slice 1 ships definition CRUD + manual recompute (separate route).
 * Slice 2 hooks child-mutation triggers via Prisma middleware so
 * rollup values stay fresh without an explicit recompute call.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { parseFilterSpec } from "@/lib/rollup/filter"
import { ENTITY_BY_KEY, type EntityKey } from "@/lib/schema-builder/registry"

const aggregateSchema = z.enum(["count", "sum", "avg", "min", "max"])

const predicateSchema = z.object({
  field: z.string().min(1).max(64),
  op: z.enum([
    "eq", "ne", "gt", "gte", "lt", "lte", "in", "nin", "isnull", "notnull",
  ]),
  value: z.unknown().optional(),
})

const createSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z_][a-z0-9_]*$/i, "name must be a valid identifier"),
    label: z.string().min(1).max(120),
    parentEntity: z.string().min(1).max(64),
    childEntity: z.string().min(1).max(64),
    aggregate: aggregateSchema,
    aggregateField: z.string().min(1).max(64).nullable().optional(),
    parentKey: z.string().min(1).max(64),
    filter: z.array(predicateSchema).max(20).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.aggregate === "count") {
      if (data.aggregateField != null) {
        ctx.addIssue({
          code: "custom",
          message: "count aggregate must not have aggregateField",
          path: ["aggregateField"],
        })
      }
    } else if (!data.aggregateField) {
      ctx.addIssue({
        code: "custom",
        message: `${data.aggregate} aggregate requires aggregateField`,
        path: ["aggregateField"],
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

export const POST = withRlsAuth("settings", "write", async (req, auth) => {
  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // Validate parent/child entity keys against the schema-builder
  // registry — otherwise a typo'd entity like "ufo" only fails at
  // recompute time with a 501, which is a UX foot-gun.
  if (!ENTITY_BY_KEY.has(parsed.data.parentEntity as EntityKey)) {
    return NextResponse.json(
      { error: `Unknown parentEntity: "${parsed.data.parentEntity}"` },
      { status: 400 }
    )
  }
  if (!ENTITY_BY_KEY.has(parsed.data.childEntity as EntityKey)) {
    return NextResponse.json(
      { error: `Unknown childEntity: "${parsed.data.childEntity}"` },
      { status: 400 }
    )
  }

  // Defensive re-parse so the runtime parser stays the source of truth
  // for filter shape. Zod already validated structure above; this is
  // belt-and-suspenders against schema drift between layers — same
  // pattern as H3's parseFieldSpecs.
  try {
    parseFilterSpec(parsed.data.filter ?? [])
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid filter" },
      { status: 400 }
    )
  }

  const created = await prisma.rollupField.create({
    data: {
      organizationId: auth.orgId,
      name: parsed.data.name,
      label: parsed.data.label,
      parentEntity: parsed.data.parentEntity,
      childEntity: parsed.data.childEntity,
      aggregate: parsed.data.aggregate,
      aggregateField: parsed.data.aggregateField ?? null,
      parentKey: parsed.data.parentKey,
      // Pass undefined (not Prisma.JsonNull) when no filter — omitting
      // the field leaves the SQL column NULL. JsonNull would write the
      // JSON literal `null`, which slice-2 readers can't distinguish
      // from an empty array. Also treat `filter: []` as "no filter":
      // JS truthiness on `[]` is true, so a naïve `parsed.data.filter ?`
      // would persist the empty array as JSON `[]` (column NOT NULL).
      // See project memory feedback_prisma_jsonb.
      filterJson:
        parsed.data.filter && parsed.data.filter.length > 0
          ? (parsed.data.filter as unknown as Prisma.InputJsonValue)
          : undefined,
      createdBy: auth.userId,
    },
  })

  return NextResponse.json({ rollupField: created }, { status: 201 })
})

export const GET = withRlsAuth("settings", "read", async (req, auth) => {
  const url = new URL(req.url)
  const parentEntity = url.searchParams.get("parentEntity")

  const fields = await prisma.rollupField.findMany({
    where: {
      organizationId: auth.orgId,
      ...(parentEntity ? { parentEntity } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  })

  return NextResponse.json({ fields })
})
