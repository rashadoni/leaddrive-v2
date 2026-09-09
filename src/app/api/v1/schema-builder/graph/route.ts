/**
 * GET /api/v1/schema-builder/graph
 *
 * Returns the curated ER graph for the Schema Builder UI (Salesforce
 * Schema Builder analogue, read-only in slice 1). Query param `group`
 * filters to one entity group (sales / people / service / marketing /
 * finance / operations / platform).
 *
 * Response shape: `{ nodes: SchemaGraphNode[], edges: SchemaGraphEdge[],
 *                    groups: { key, count }[] }`
 *
 * Slice 2 will add: per-org overrides, field-level metadata from
 * `CustomField`, "describe" endpoint for a single entity.
 *
 * Part of N9 Schema Builder (Phase 2 roadmap).
 */
import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { buildSchemaGraph, type EntityGroup } from "@/lib/schema-builder/registry"

const VALID_GROUPS: ReadonlySet<EntityGroup> = new Set<EntityGroup>([
  "sales", "people", "service", "marketing", "finance", "operations", "platform",
])

// Cached payloads — registry is process-static, no per-org data, so we
// memoise per `group` filter at module scope. 8 keys total (7 groups + null).
const cache = new Map<string, ReturnType<typeof buildSchemaGraph>>()

function getCachedGraph(group: EntityGroup | null) {
  const key = group ?? "_all"
  const existing = cache.get(key)
  if (existing) return existing
  const fresh = buildSchemaGraph(group)
  cache.set(key, fresh)
  return fresh
}

export const GET = withRlsAuth(undefined, undefined, async (req, auth) => {
  const groupParam = req.nextUrl.searchParams.get("group")
  let group: EntityGroup | null = null
  if (groupParam) {
    if (!VALID_GROUPS.has(groupParam as EntityGroup)) {
      return NextResponse.json(
        { error: "Invalid group", validGroups: [...VALID_GROUPS] },
        { status: 400 }
      )
    }
    group = groupParam as EntityGroup
  }

  const graph = getCachedGraph(group)
  return NextResponse.json(graph)
})
