/**
 * POST /api/v1/rollup-fields/[id]/recompute
 *
 * Recompute a rollup-field's values across every parent record in the
 * tenant. Slice 1 supports a fixed set of parent/child entity pairs;
 * slice 2 hooks Prisma middleware so individual child mutations
 * incrementally update affected `RollupValue` rows.
 *
 * Slice 1 supported entity pairs (parent ← child via parentKey):
 *   company ← deal      (parentKey: "companyId")
 *   company ← contact   (parentKey: "companyId")
 *   company ← ticket    (parentKey: "companyId")
 *   deal    ← invoice   (parentKey: "dealId")
 *   deal    ← offer     (parentKey: "dealId")
 *
 * Other pairs return 501 — slice 2 widens the dispatch.
 *
 * Part of N6 Rollup Summary fields (Phase 4 slice 1).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { MAX_PARENTS_PER_RECOMPUTE, computeRollups } from "@/lib/rollup/engine"
import { parseFilterSpec } from "@/lib/rollup/filter"
import type { RollupSpec } from "@/lib/rollup/types"

interface EntityDispatch {
  fetchParents: (organizationId: string) => Promise<readonly { id: string }[]>
  fetchChildren: (
    organizationId: string,
    aggregateField: string | null
  ) => Promise<readonly Record<string, unknown>[]>
}

/**
 * Per-entity-pair dispatch. Each pair declares how to fetch the
 * universe of parents + the relevant child columns. Slice 1 hardcodes
 * the projection per pair so the route stays type-safe; slice 2
 * generates this from the schema-builder registry.
 */
function dispatchFor(
  parentEntity: string,
  childEntity: string
): EntityDispatch | null {
  // company ← deal
  if (parentEntity === "company" && childEntity === "deal") {
    return {
      fetchParents: orgId =>
        prisma.company.findMany({
          where: { organizationId: orgId },
          select: { id: true },
        }),
      fetchChildren: async (orgId, aggregateField) => {
        // Pull only the columns we need — companyId for grouping plus
        // the aggregate column. Filter fields can extend this in slice 2.
        const baseSelect: Record<string, boolean> = {
          companyId: true,
          stage: true,
          valueAmount: true,
        }
        if (aggregateField) baseSelect[aggregateField] = true
        return prisma.deal.findMany({
          where: { organizationId: orgId, companyId: { not: null } },
          select: baseSelect,
        }) as Promise<Record<string, unknown>[]>
      },
    }
  }
  // company ← contact
  if (parentEntity === "company" && childEntity === "contact") {
    return {
      fetchParents: orgId =>
        prisma.company.findMany({
          where: { organizationId: orgId },
          select: { id: true },
        }),
      fetchChildren: async (orgId, aggregateField) => {
        const baseSelect: Record<string, boolean> = { companyId: true }
        if (aggregateField) baseSelect[aggregateField] = true
        return prisma.contact.findMany({
          where: { organizationId: orgId, companyId: { not: null } },
          select: baseSelect,
        }) as Promise<Record<string, unknown>[]>
      },
    }
  }
  // company ← ticket
  if (parentEntity === "company" && childEntity === "ticket") {
    return {
      fetchParents: orgId =>
        prisma.company.findMany({
          where: { organizationId: orgId },
          select: { id: true },
        }),
      fetchChildren: async (orgId, aggregateField) => {
        const baseSelect: Record<string, boolean> = {
          companyId: true,
          status: true,
          priority: true,
        }
        if (aggregateField) baseSelect[aggregateField] = true
        return prisma.ticket.findMany({
          where: { organizationId: orgId, companyId: { not: null } },
          select: baseSelect,
        }) as Promise<Record<string, unknown>[]>
      },
    }
  }
  // deal ← invoice
  if (parentEntity === "deal" && childEntity === "invoice") {
    return {
      fetchParents: orgId =>
        prisma.deal.findMany({
          where: { organizationId: orgId },
          select: { id: true },
        }),
      fetchChildren: async (orgId, aggregateField) => {
        const baseSelect: Record<string, boolean> = {
          dealId: true,
          status: true,
        }
        if (aggregateField) baseSelect[aggregateField] = true
        return prisma.invoice.findMany({
          where: { organizationId: orgId, dealId: { not: null } },
          select: baseSelect,
        }) as Promise<Record<string, unknown>[]>
      },
    }
  }
  // deal ← offer
  if (parentEntity === "deal" && childEntity === "offer") {
    return {
      fetchParents: orgId =>
        prisma.deal.findMany({
          where: { organizationId: orgId },
          select: { id: true },
        }),
      fetchChildren: async (orgId, aggregateField) => {
        const baseSelect: Record<string, boolean> = {
          dealId: true,
          status: true,
        }
        if (aggregateField) baseSelect[aggregateField] = true
        return prisma.offer.findMany({
          where: { organizationId: orgId, dealId: { not: null } },
          select: baseSelect,
        }) as Promise<Record<string, unknown>[]>
      },
    }
  }
  return null
}

export const POST = withRlsAuth("settings", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const field = await prisma.rollupField.findFirst({
    where: { id, organizationId: auth.orgId },
  })
  if (!field) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!field.isActive) {
    return NextResponse.json({ error: "Rollup field is inactive" }, { status: 409 })
  }

  const dispatch = dispatchFor(field.parentEntity, field.childEntity)
  if (!dispatch) {
    return NextResponse.json(
      {
        error: `Entity pair (${field.parentEntity} ← ${field.childEntity}) not supported in slice 1`,
      },
      { status: 501 }
    )
  }

  let filter
  try {
    filter = parseFilterSpec(field.filterJson)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid filter spec" },
      { status: 422 }
    )
  }

  const spec: RollupSpec = {
    id: field.id,
    name: field.name,
    parentEntity: field.parentEntity,
    childEntity: field.childEntity,
    aggregate: field.aggregate as RollupSpec["aggregate"],
    aggregateField: field.aggregateField,
    parentKey: field.parentKey,
    filter,
  }

  const parents = await dispatch.fetchParents(auth.orgId)

  // Slice 1 does N-by-N upserts — at >10k parents this becomes a
  // problem (~minutes of serial DB roundtrips). Slice 2 batches via
  // raw ON CONFLICT, so refuse with 413 until then. The cap lives in
  // the engine module so the error message + the runtime check share
  // one source of truth.
  if (parents.length > MAX_PARENTS_PER_RECOMPUTE) {
    return NextResponse.json(
      {
        error: `Tenant has ${parents.length} parent records; slice 1 recompute caps at ${MAX_PARENTS_PER_RECOMPUTE}. Slice 2 batches will lift this.`,
      },
      { status: 413 }
    )
  }

  const children = await dispatch.fetchChildren(auth.orgId, field.aggregateField)

  const computations = computeRollups({
    spec,
    parentIds: parents.map(p => p.id),
    children,
  })

  // Upsert each result. Slice 1 does one upsert per parent — slice 2
  // batches via a single ON CONFLICT statement for large tenants.
  let written = 0
  for (const c of computations) {
    await prisma.rollupValue.upsert({
      where: {
        rollupFieldId_parentId: {
          rollupFieldId: field.id,
          parentId: c.parentId,
        },
      },
      create: {
        rollupFieldId: field.id,
        organizationId: auth.orgId,
        parentId: c.parentId,
        numericValue: c.numericValue,
        childCount: c.childCount,
      },
      update: {
        numericValue: c.numericValue,
        childCount: c.childCount,
        computedAt: new Date(),
      },
    })
    written++
  }

  return NextResponse.json({
    success: true,
    rollupFieldId: field.id,
    summary: {
      parentsConsidered: parents.length,
      parentsWithChildren: computations.filter(c => c.childCount > 0).length,
      childRowsScanned: children.length,
      valuesWritten: written,
    },
  })
})

