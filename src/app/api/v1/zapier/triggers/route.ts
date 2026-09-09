/**
 * GET /api/v1/zapier/triggers
 *
 * Catalog of Zapier subscribe-hook triggers exposed by LeadDrive. Used by
 * the Zapier Platform app to populate the "Choose a Trigger" dropdown.
 *
 * Static list — synced with `WebhookEvent` union in `src/lib/webhooks.ts`.
 * When adding a new event there, mirror it here with a sample payload key
 * under `/api/v1/zapier/samples/[trigger]`.
 *
 * Part of L6 Native Zapier Connector.
 */
import { NextRequest, NextResponse } from "next/server"
import { getZapierAuth } from "@/lib/zapier-auth"
import { ZAPIER_TRIGGER_CATALOG } from "@/lib/zapier-triggers"

export async function GET(req: NextRequest) {
  const auth = await getZapierAuth(req)
  if (!auth) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 })
  }

  return NextResponse.json({ triggers: ZAPIER_TRIGGER_CATALOG })
}
