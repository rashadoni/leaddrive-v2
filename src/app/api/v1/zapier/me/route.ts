/**
 * GET /api/v1/zapier/me
 *
 * Zapier "auth test" endpoint — Zapier Platform calls this when a user
 * pastes an API key during Zap setup to verify the credential and display
 * the connected account name in the UI.
 *
 * Response contract:
 *   { id, org_id, org_name, org_slug, api_key_name, scopes }
 *
 * Part of L6 Native Zapier Connector.
 */
import { NextRequest, NextResponse } from "next/server"
import { getZapierAuth } from "@/lib/zapier-auth"

export async function GET(req: NextRequest) {
  const auth = await getZapierAuth(req)
  if (!auth) {
    return NextResponse.json(
      { error: "invalid_credentials", message: "Invalid or expired API key" },
      { status: 401 }
    )
  }

  return NextResponse.json({
    id: auth.apiKeyId,
    org_id: auth.orgId,
    org_name: auth.organizationName,
    org_slug: auth.organizationSlug,
    api_key_name: auth.apiKeyName,
    scopes: auth.scopes,
  })
}
