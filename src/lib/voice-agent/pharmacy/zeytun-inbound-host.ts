import { constants } from "node:fs"
import { lstat, open } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"
import { runWithTenant } from "../../rls-context"
import { ZeytunAvailableBalances } from "./zeytun-available-balances"
import { ZeytunSnapshotStore } from "./zeytun-snapshot-store"
import { inboundPilotDigest, type InboundPilotCall, type InboundPilotConfig, type InboundPilotDependencies } from "./zeytun-inbound-pilot"
import type { ZeytunCallDatabase } from "./zeytun-call-loader"

/** Tiny operator grant/claim reads; the catalog is parsed once, with no 1C I/O. */
async function readPrivate(path: string, limit = 8192): Promise<unknown> {
  if (!isAbsolute(path)) throw new Error("invalid_private_path")
  const dir = await lstat(dirname(path))
  if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077) || dir.uid !== process.getuid?.()) throw new Error("private_directory_required")
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) || stat.uid !== process.getuid?.() || stat.size > limit) throw new Error("private_file_required")
    const buffer = Buffer.alloc(limit + 1), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > limit) throw new Error("private_file_too_large")
    return JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"))
  } finally { await handle.close() }
}
export function createInboundPilotHost(options: {
  configFile: string; snapshotDirectory: string; runtimeOrganizationId: string; database: ZeytunCallDatabase
}): InboundPilotDependencies {
  let catalog: { key: string; value: ReturnType<InboundPilotDependencies["loadCatalog"]> } | null = null
  const claimPath = (config: InboundPilotConfig) => join(dirname(options.configFile), `inbound-${config.id}.claim`)
  const claimValue = (config: InboundPilotConfig, call: InboundPilotCall) => ({
    grantDigest: inboundPilotDigest(config), callId: call.providerCallId, callLogId: call.id,
  })
  const isClaimed = async (config: InboundPilotConfig, call: InboundPilotCall) => {
    try { return JSON.stringify(await readPrivate(claimPath(config), 2048)) === JSON.stringify(claimValue(config, call)) }
    catch { return false }
  }
  const markPreview = async (config: InboundPilotConfig, call: InboundPilotCall) => {
    const marker = JSON.stringify({ version: 1, grantId: config.id, providerCallId: call.providerCallId })
    const rows = await runWithTenant(config.organizationId, () => options.database.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.org_id', ${config.organizationId}, true),
        set_config('app.rls_bypass', 'off', true), set_config('statement_timeout', '1500ms', true), set_config('lock_timeout', '500ms', true)`
      return tx.$queryRaw<Array<{ id: string }>>`
        UPDATE call_logs SET "consentAudit" = coalesce("consentAudit", '{}'::jsonb) ||
          jsonb_build_object('pharmacyInboundPreview', ${marker}::jsonb)
        WHERE id=${call.id} AND "organizationId"=${config.organizationId} AND "channelConfigId"=${config.channelConfigId}
          AND provider='asterisk' AND "providerCallId"=${call.providerCallId} AND direction='inbound'
          AND "callMode"='ai' AND status='in-progress' AND "wasAnswered"=true AND "endedAt" IS NULL
          AND ("consentAudit" IS NULL OR jsonb_typeof("consentAudit")='object')
          AND ("consentAudit"->'pharmacyInboundPreview' IS NULL OR "consentAudit"->'pharmacyInboundPreview'=${marker}::jsonb)
        RETURNING id
      `
    }, { isolationLevel: "ReadCommitted", maxWait: 500, timeout: 2500 }))
    return rows.length === 1 && rows[0].id === call.id
  }
  return {
    async loadConfig() {
      if (!options.configFile) return null
      const config = await readPrivate(options.configFile)
      if (config && typeof config === "object" && "enabled" in config && config.enabled === false) return null
      return config
    },
    async loadCall(config, callId) {
      if (config.organizationId !== options.runtimeOrganizationId) return null
      const rows = await runWithTenant(config.organizationId, () => options.database.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('app.org_id', ${config.organizationId}, true),
          set_config('app.rls_bypass', 'off', true), set_config('statement_timeout', '1500ms', true), set_config('lock_timeout', '500ms', true)`
        return tx.$queryRaw<Array<Omit<InboundPilotCall, "startedAt"> & { startedAt: Date }>>`
          WITH candidates AS (
            SELECT id, "organizationId", "channelConfigId", "providerCallId", provider, direction, "callMode", status,
              "wasAnswered", "endedAt", "startedAt", "fromNumber", "targetPhoneE164"
            FROM call_logs WHERE "organizationId"=${config.organizationId} AND provider='asterisk' AND "providerCallId"=${callId} LIMIT 2
          ) SELECT c.* FROM candidates c
          JOIN organizations org ON org.id=c."organizationId" AND org."isActive"=true
          JOIN channel_configs ch ON ch.id=c."channelConfigId" AND ch."organizationId"=c."organizationId"
          WHERE (SELECT count(*) FROM candidates)=1 AND ch.id=${config.channelConfigId}
            AND ch."channelType"='voip' AND ch."isActive"=true AND ch.settings->'provider'='"asterisk"'::jsonb
            AND ch.settings->'voiceAgentEnabled'='true'::jsonb
        `
      }, { isolationLevel: "ReadCommitted", maxWait: 500, timeout: 2500 }))
      if (rows.length !== 1 || !(rows[0].startedAt instanceof Date)) return null
      return { ...rows[0], startedAt: rows[0].startedAt.toISOString() }
    },
    async loadCatalog(config) {
      const key = inboundPilotDigest(config)
      if (catalog?.key === key) return catalog.value
      const value = (async () => {
        const source = config.approvedSource
        const store = new ZeytunSnapshotStore(options.snapshotDirectory, source.organizationId, source.scopeKey)
        const snapshot = await store.load()
        if (!snapshot || snapshot.version !== source.catalogVersion) throw new Error("snapshot_unavailable")
        const feed = new ZeytunAvailableBalances(snapshot.payload, snapshot.context)
        return { organizationId: source.organizationId, scopeKey: source.scopeKey, version: snapshot.version,
          observedAt: snapshot.context.observedAt, source: snapshot.context.source,
          search: (query: Parameters<ZeytunAvailableBalances["search"]>[1]) => feed.search(source.organizationId, query) }
      })()
      catalog = { key, value }
      // Keep a failed promise pinned as well: a missing/corrupt 25MB snapshot
      // must not be reread on every spoken request. New operator grant retries.
      return value
    },
    isClaimed,
    async claim(config, call) {
      if (config.organizationId !== options.runtimeOrganizationId) return false
      // Parent permissions are checked by loadConfig before a claim. Exclusive
      // creation binds this grant to one call across processes/restarts.
      let handle
      try { handle = await open(claimPath(config), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return (await isClaimed(config, call)) && markPreview(config, call)
        throw error
      }
      try { await handle.writeFile(JSON.stringify(claimValue(config, call))); await handle.sync() }
      finally { await handle.close() }
      // Written before the agent speaks. Revocation/expiry cannot erase the
      // durable exclusion from normal sales analysis and commitment extraction.
      return markPreview(config, call)
    },
  }
}
