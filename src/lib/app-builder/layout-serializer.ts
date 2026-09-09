/**
 * Layout serializer — N2 Phase 6 Block D slice 1.
 *
 * Given a page + flat lists of regions + widgets (typically straight
 * out of Prisma `findMany` calls), assemble a render-ready nested
 * structure for the slice-2 UI layer to consume.
 *
 * Helper does NOT validate widget configs — that's widget-validator's
 * job at INSERT/UPDATE time. It DOES filter out invisible widgets
 * (isVisible=false) so the consumer never receives ghosts.
 *
 * Pure synchronous.
 *
 * Edge cases:
 *   • Region with no widgets → kept (empty array).
 *   • Widget referencing unknown regionId → REJECTED (caller's bug).
 *   • Duplicate displayOrder within a region/page → REJECTED (DB
 *     UNIQUE should prevent this; helper is defensive).
 */
import type {
  LayoutPage,
  LayoutRegion,
  LayoutWidget,
  SerializeLayoutInput,
  SerializeLayoutResult,
  SerializedLayout,
  SerializedRegion,
  SerializedWidget,
} from "./types"

export function serializeLayout(
  input: SerializeLayoutInput
): SerializeLayoutResult {
  if (!input.page || typeof input.page !== "object") {
    return { ok: false, error: "page must be an object" }
  }
  if (!Array.isArray(input.regions)) {
    return { ok: false, error: "regions must be an array" }
  }
  if (!Array.isArray(input.widgets)) {
    return { ok: false, error: "widgets must be an array" }
  }

  // 1. Sort regions by displayOrder.
  const sortedRegions = [...input.regions].sort((a, b) => a.displayOrder - b.displayOrder)

  // 2. Check region displayOrder uniqueness within page.
  const regionOrders = new Set<number>()
  for (const r of sortedRegions) {
    if (regionOrders.has(r.displayOrder)) {
      return {
        ok: false,
        error: `duplicate region displayOrder ${r.displayOrder} on page ${input.page.id}`,
      }
    }
    regionOrders.add(r.displayOrder)
    if (r.pageId !== input.page.id) {
      return {
        ok: false,
        error: `region ${r.id} pageId "${r.pageId}" does not match page "${input.page.id}"`,
      }
    }
  }

  // 3. Group widgets by regionId.
  const widgetsByRegion = new Map<string, LayoutWidget[]>()
  for (const w of input.widgets) {
    const list = widgetsByRegion.get(w.regionId) ?? []
    list.push(w)
    widgetsByRegion.set(w.regionId, list)
  }

  // 4. Verify every widget references a known region.
  const knownRegionIds = new Set(sortedRegions.map((r) => r.id))
  for (const w of input.widgets) {
    if (!knownRegionIds.has(w.regionId)) {
      return {
        ok: false,
        error: `widget ${w.id} references unknown regionId "${w.regionId}"`,
      }
    }
  }

  // 5. Assemble serialized regions.
  const serialized: SerializedRegion[] = []
  for (const r of sortedRegions) {
    const list = widgetsByRegion.get(r.id) ?? []
    // Filter invisible widgets out.
    const visible = list.filter((w) => w.isVisible)
    // Sort by displayOrder + check uniqueness.
    visible.sort((a, b) => a.displayOrder - b.displayOrder)
    const widgetOrders = new Set<number>()
    for (const w of visible) {
      if (widgetOrders.has(w.displayOrder)) {
        return {
          ok: false,
          error: `duplicate widget displayOrder ${w.displayOrder} in region ${r.id}`,
        }
      }
      widgetOrders.add(w.displayOrder)
    }
    const serializedWidgets: SerializedWidget[] = visible.map((w) => ({
      id: w.id,
      widgetType: w.widgetType,
      displayOrder: w.displayOrder,
      config: w.config,
      label: w.label,
    }))
    serialized.push({
      id: r.id,
      regionType: r.regionType,
      displayOrder: r.displayOrder,
      widthCols: r.widthCols,
      label: r.label,
      widgets: serializedWidgets,
    })
  }

  const layout: SerializedLayout = {
    pageId: input.page.id,
    pageSlug: input.page.slug,
    pageName: input.page.name,
    pageStatus: input.page.status,
    objectType: input.page.objectType,
    version: input.page.version,
    regions: serialized,
  }
  return { ok: true, layout }
}

/**
 * Helpful type-guard for callers that pre-fetch from Prisma. Not used
 * by the serializer directly but exposed for slice-2 caller code.
 */
export function isLayoutPage(v: unknown): v is LayoutPage {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === "string" &&
    typeof o.slug === "string" &&
    typeof o.name === "string" &&
    typeof o.objectType === "string"
  )
}

export function isLayoutRegion(v: unknown): v is LayoutRegion {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === "string" &&
    typeof o.pageId === "string" &&
    typeof o.displayOrder === "number"
  )
}

export function isLayoutWidget(v: unknown): v is LayoutWidget {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === "string" &&
    typeof o.regionId === "string" &&
    typeof o.displayOrder === "number" &&
    typeof o.isVisible === "boolean"
  )
}
