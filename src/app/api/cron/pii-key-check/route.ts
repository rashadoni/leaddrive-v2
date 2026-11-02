/**
 * Deploy probe: can the running process load the PII master key, and from
 * where? `/login` and `/api/v1/ping` never touch the key, so without this a
 * process that cannot read it would pass every health check and then fail on
 * every encrypted field. `scripts/server-deploy.sh` requires
 * `{"ok":true,"source":"file"}` — loaded, and from the env file rather than the
 * process environment — and rolls back otherwise.
 *
 * Says nothing about the key itself.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/lib/cron-auth"
import { isTenantPiiMasterKeyConfigured } from "@/lib/crypto/tenant-pii-encryption"

export async function POST(req: NextRequest) {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError
  const source = process.env.TENANT_PII_MASTER_KEY ? "environment" : process.env.TENANT_PII_MASTER_KEY_FILE ? "file" : "none"
  return NextResponse.json(
    { ok: isTenantPiiMasterKeyConfigured(), source },
    { headers: { "Cache-Control": "no-store" } },
  )
}
