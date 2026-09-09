/**
 * GET /api/v1/dashboard/widgets
 *
 * Catalog of widget types available in the Dashboard Builder UI. Driven by
 * `WIDGET_CATALOG` in `src/lib/dashboard/widgets.ts` — adding a widget type
 * there flows through here without route changes.
 *
 * Cached at module scope (catalog is static at process boot, never per-org).
 *
 * Part of I2 No-code Dashboard Builder (Phase 2 slice 1).
 */
import { NextResponse } from "next/server"
import { withRls } from "@/lib/with-rls"
import { WIDGET_CATALOG } from "@/lib/dashboard/widgets"

const CACHED_BODY = { widgets: WIDGET_CATALOG }

export const GET = withRls(async (_req, { orgId }) => {
  return NextResponse.json(CACHED_BODY)
})
