import { phoneOrdersEnabled } from "@/lib/pharmacy-orders/orders"
import { pharmacyRowFrom1c, syncPharmacyCompanies } from "@/lib/pharmacy-orders/pharmacy-companies"
import { prisma } from "@/lib/prisma"
import { ZeytunClientsDirectory } from "@/lib/voice-agent/pharmacy/zeytun-clients-directory"
import { inboundPilotConfigSchema, isLineGrant } from "@/lib/voice-agent/pharmacy/zeytun-inbound-pilot"
import { readPrivate } from "@/lib/voice-agent/pharmacy/zeytun-private-file"
import { ZeytunSnapshotStore } from "@/lib/voice-agent/pharmacy/zeytun-snapshot-store"

/**
 * Load the line's 1C pharmacy list into Zeytun's companies, from the snapshot
 * the refresh tick keeps (no 1C request here). The line's grant names both the
 * snapshot (pharmacySource) and the organization (orderOrganizationId); a
 * list already loaded changes nothing. Returns counts only, never a pharmacy.
 */
export async function loadZeytunPharmacyCompanies(env: { grantFile?: string; cacheDir?: string } = {
  grantFile: process.env.ZEYTUN_INBOUND_PILOT_FILE, cacheDir: process.env.ZEYTUN_CACHE_DIR,
}) {
  if (!env.grantFile || !env.cacheDir) return { outcome: "not_configured" as const }
  let grant
  try { grant = inboundPilotConfigSchema.parse(await readPrivate(env.grantFile)) }
  catch { return { outcome: "not_configured" as const } }
  if (!isLineGrant(grant) || !grant.pharmacySource) return { outcome: "not_configured" as const }
  const orgId = grant.orderOrganizationId
  if (!(await phoneOrdersEnabled(orgId))) return { outcome: "not_enabled" as const }
  const source = grant.pharmacySource
  const snapshot = await new ZeytunSnapshotStore(env.cacheDir, source.organizationId, source.scopeKey).load()
  if (!snapshot) return { outcome: "no_snapshot" as const }
  const directory = new ZeytunClientsDirectory(snapshot.payload, snapshot.context)
  const rows = directory.all(source.organizationId).map(pharmacyRowFrom1c)
  const result = await syncPharmacyCompanies(prisma, orgId, rows, new Date(snapshot.context.observedAt))
  return { outcome: "loaded" as const, observedAt: snapshot.context.observedAt, pharmacies: rows.length, ...result }
}
