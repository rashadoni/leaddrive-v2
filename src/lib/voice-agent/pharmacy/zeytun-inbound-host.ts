import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { dirname, join } from "node:path"
import { runWithTenant } from "../../rls-context"
import { readPrivate } from "./zeytun-private-file"
import { ZeytunAvailableBalances } from "./zeytun-available-balances"
import { ZeytunSnapshotStore } from "./zeytun-snapshot-store"
import { inboundPilotDigest, isLineGrant, type InboundPilotCall, type InboundPilotConfig, type InboundPilotDependencies } from "./zeytun-inbound-pilot"
import type { ZeytunCallDatabase } from "./zeytun-call-loader"
import { savePhoneOrderFromCall } from "./phone-orders"
import { requestAiHandoff } from "../../voip/inbound-handoff"
import { notifyManagersOfPhoneOrder } from "../../pharmacy-orders/manager-notice"
import { ZeytunClientsDirectory } from "./zeytun-clients-directory"
import { identifyPharmacy, type PharmacyCandidate } from "./zeytun-pharmacy-identity"
import type { PrismaClient } from "@prisma/client"

// 2026-10-25 live call: the session request got 503 and the station ended the
// call in silence. Parsing the 14 MB catalog holds this process ~2 s, and the
// call's transaction had 500 ms to start. The station allows 5 s per session
// request; the transaction now waits up to 3 s for a connection.
const CALL_TX_MAX_WAIT_MS = 3000, CALL_TX_TIMEOUT_MS = 4500

/** The caller's number in international form when it is one; otherwise as the PBX gave it. */
function callerNumber(value: string) {
  const compact = value.replace(/[\s()-]/gu, "")
  const digits = compact.startsWith("+") ? compact.slice(1) : compact
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : value.slice(0, 64)
}
/** A directory older than this is not used to name a caller: 1C stopped answering. */
const PHARMACY_DIRECTORY_MAX_AGE_MS = 7 * 24 * 60 * 60_000

export function createInboundPilotHost(options: {
  configFile: string; snapshotDirectory: string; runtimeOrganizationId: string; database: ZeytunCallDatabase
  /** The application client the phone orders are written with (tenant RLS). */
  orders?: PrismaClient
  /** Whether an organization holds a line number routed to this VoIP channel
   * (voice_line_numbers). A line grant runs in such an organization even when
   * it is not the installation's default one. */
  holdsLine?: (organizationId: string, channelConfigId: string) => Promise<boolean>
  /** Whether the organization's managers can take calls in the CRM browser. */
  transferAvailable?: (organizationId: string) => Promise<boolean>
}): InboundPilotDependencies {
  // The rehearsal belongs to the installation's default organization. The
  // line runs where its number is: owner, 2026-10-26 («переноси линию Зейтуна
  // в его организацию»), the number assigned to Zeytun with its own channel.
  const allowedOrganization = async (config: InboundPilotConfig) => config.organizationId === options.runtimeOrganizationId
    || (isLineGrant(config) && Boolean(options.holdsLine) && await options.holdsLine!(config.organizationId, config.channelConfigId))
  let catalog: { key: string; at: number; value: ReturnType<InboundPilotDependencies["loadCatalog"]>; next?: Promise<void> } | null = null
  // The pharmacy list is small (~1 200 rows, ~0.1 s to parse): re-read when
  // its header changes, looked at no more than once a minute.
  let pharmacies: { key: string; version: string; at: number; directory: ZeytunClientsDirectory } | null = null
  async function findPharmacies(config: InboundPilotConfig, phoneE164: string): Promise<PharmacyCandidate[]> {
    if (!isLineGrant(config) || !config.pharmacySource || !/^\+[1-9]\d{7,14}$/.test(phoneE164)) return []
    const source = config.pharmacySource, key = `${source.organizationId}:${source.scopeKey}`
    const store = new ZeytunSnapshotStore(options.snapshotDirectory, source.organizationId, source.scopeKey)
    if (!pharmacies || pharmacies.key !== key || Date.now() - pharmacies.at >= 60_000) {
      const head = await store.peek()
      if (!head) return []
      if (pharmacies?.key === key && pharmacies.version === head.version) pharmacies.at = Date.now()
      else {
        const saved = await store.load()
        if (!saved) return []
        pharmacies = { key, version: saved.version, at: Date.now(), directory: new ZeytunClientsDirectory(saved.payload, saved.context) }
      }
    }
    const summary = pharmacies.directory.summary(source.organizationId)
    if (summary.source !== "live" || Date.now() - Date.parse(summary.observedAt) > PHARMACY_DIRECTORY_MAX_AGE_MS) return []
    return pharmacies.directory.findByPhone(source.organizationId, phoneE164).candidates
      .map((client) => ({ guid: client.counterpartyGuid, name: client.name, address: client.address || null }))
  }
  // The rehearsal binds its grant to one call; the line claims each call apart.
  const claimPath = (config: InboundPilotConfig, call: InboundPilotCall) => join(dirname(options.configFile),
    isLineGrant(config) ? `line-${config.id}-${call.providerCallId}.claim` : `inbound-${config.id}.claim`)
  const claimValue = (config: InboundPilotConfig, call: InboundPilotCall) => ({
    grantDigest: inboundPilotDigest(config), callId: call.providerCallId, callLogId: call.id,
  })
  const isClaimed = async (config: InboundPilotConfig, call: InboundPilotCall) => {
    try { return JSON.stringify(await readPrivate(claimPath(config, call), 2048)) === JSON.stringify(claimValue(config, call)) }
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
    }, { isolationLevel: "ReadCommitted", maxWait: CALL_TX_MAX_WAIT_MS, timeout: CALL_TX_TIMEOUT_MS }))
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
      if (!(await allowedOrganization(config))) return null
      const rows = await runWithTenant(config.organizationId, () => options.database.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('app.org_id', ${config.organizationId}, true),
          set_config('app.rls_bypass', 'off', true), set_config('statement_timeout', '1500ms', true), set_config('lock_timeout', '500ms', true)`
        return tx.$queryRaw<Array<Omit<InboundPilotCall, "startedAt"> & { startedAt: Date }>>`
          WITH candidates AS (
            SELECT id, "organizationId", "channelConfigId", "providerCallId", provider, direction, "callMode", status,
              "wasAnswered", "endedAt", "startedAt", "fromNumber", "targetPhoneE164", "handoffState"
            FROM call_logs WHERE "organizationId"=${config.organizationId} AND provider='asterisk' AND "providerCallId"=${callId} LIMIT 2
          ) SELECT c.* FROM candidates c
          JOIN organizations org ON org.id=c."organizationId" AND org."isActive"=true
          JOIN channel_configs ch ON ch.id=c."channelConfigId" AND ch."organizationId"=c."organizationId"
          WHERE (SELECT count(*) FROM candidates)=1 AND ch.id=${config.channelConfigId}
            AND ch."channelType"='voip' AND ch."isActive"=true AND ch.settings->'provider'='"asterisk"'::jsonb
            AND ch.settings->'voiceAgentEnabled'='true'::jsonb
        `
      }, { isolationLevel: "ReadCommitted", maxWait: CALL_TX_MAX_WAIT_MS, timeout: CALL_TX_TIMEOUT_MS }))
      if (rows.length !== 1 || !(rows[0].startedAt instanceof Date)) return null
      return { ...rows[0], startedAt: rows[0].startedAt.toISOString() }
    },
    async loadCatalog(config) {
      const key = inboundPilotDigest(config)
      const load = () => (async () => {
        const source = config.approvedSource
        const store = new ZeytunSnapshotStore(options.snapshotDirectory, source.organizationId, source.scopeKey)
        const snapshot = await store.load()
        // The rehearsal is pinned to the version the owner approved; the line
        // takes the newest live snapshot the refresh cron saved.
        if (!snapshot || (!isLineGrant(config) && snapshot.version !== config.approvedSource.catalogVersion)) throw new Error("snapshot_unavailable")
        const feed = new ZeytunAvailableBalances(snapshot.payload, snapshot.context)
        return { organizationId: source.organizationId, scopeKey: source.scopeKey, version: snapshot.version,
          observedAt: snapshot.context.observedAt, source: snapshot.context.source, vocabulary: feed.manufacturerWords(400),
          search: (query: Parameters<ZeytunAvailableBalances["search"]>[1]) => feed.search(source.organizationId, query) }
      })()
      if (catalog?.key !== key) {
        catalog = { key, at: Date.now(), value: load() }
        // Keep a failed promise pinned as well: a missing/corrupt 25MB snapshot
        // must not be reread on every spoken request. New operator grant retries.
        return catalog.value
      }
      // The line lives for weeks: look at the store every ten minutes in the
      // background and keep answering from the parsed copy meanwhile. Only the
      // header is read first: the same snapshot re-observed by the refresh cron
      // takes its new date without a re-parse, which holds this process ~2 s.
      // A failed look keeps the copy; the request path's age gate still applies.
      if (isLineGrant(config) && !catalog.next && Date.now() - catalog.at >= 10 * 60_000) {
        const current = catalog
        const source = config.approvedSource
        current.next = (async () => {
          const head = await new ZeytunSnapshotStore(options.snapshotDirectory, source.organizationId, source.scopeKey).peek()
          const parsed = await current.value
          if (!head) throw new Error("snapshot_unavailable")
          const fresh = head.version === parsed.version
            ? Promise.resolve({ ...parsed, observedAt: head.observedAt })
            : load()
          await fresh
          if (catalog === current) catalog = { key, at: Date.now(), value: fresh }
        })().catch(() => {
          if (catalog === current) { current.at = Date.now(); current.next = undefined }
        })
      }
      return catalog.value
    },
    isClaimed,
    findPharmacies,
    ...(options.orders ? {
      // The pilot's caller is the owner's test participant: the order is
      // marked a test call and names no pharmacy (shared numbers in 1C cannot
      // identify one). The number is the grant's, which the call matched.
      saveOrder: async (config, call, catalog, lines, pharmacy) => {
        const base = { organizationId: config.orderOrganizationId, providerCallId: call.providerCallId,
          callStartedAt: call.startedAt, catalog, lines }
        if (!isLineGrant(config)) {
          return savePhoneOrderFromCall(options.orders!, { ...base, callerPhoneE164: config.testPhoneE164, identification: "test_call" })
        }
        // The 1C pharmacy when the number names one the caller did not
        // contradict, or the one of a shared number the caller named; a name
        // matching nothing in 1C is kept as said, never as a 1C pharmacy.
        const caller = callerNumber(call.fromNumber)
        const identity = identifyPharmacy(await findPharmacies(config, caller).catch(() => []), pharmacy)
        const saved = await savePhoneOrderFromCall(options.orders!, { ...base, callerPhoneE164: caller, identification: identity.identification,
          ...("pharmacy" in identity
            ? { pharmacyName: identity.pharmacy.name, pharmacyGuid: identity.pharmacy.guid, pharmacyAddress: identity.pharmacy.address }
            : "spoken" in identity ? { pharmacyName: identity.spoken } : {}) })
        // The manager hears of a new order on WhatsApp; the call does not wait for it.
        if (saved.status === "saved" && saved.created) {
          void notifyManagersOfPhoneOrder(options.orders!, config.orderOrganizationId, saved.orderId)
            .catch((error: unknown) => console.warn("[zeytun-line] manager notice failed", error instanceof Error ? error.name : typeof error))
        }
        return saved
      },
    } satisfies Pick<InboundPilotDependencies, "saveOrder"> : {}),
    ...(options.orders && options.transferAvailable ? {
      // Owner, 2026-10-27: the caller asks for a person, the managers' browsers
      // ring. Only where someone can take a browser call; once per call.
      requestTransfer: async (config, call) => {
        if (!(await allowedOrganization(config)) || !(await options.transferAvailable!(config.organizationId).catch(() => false))) return "unavailable"
        const ref = { organizationId: config.organizationId, callLogId: call.id, providerCallId: call.providerCallId }
        return await runWithTenant(config.organizationId, () => requestAiHandoff(options.orders!, ref)) ? "transferring" : "unavailable"
      },
    } satisfies Pick<InboundPilotDependencies, "requestTransfer"> : {}),
    async claim(config, call) {
      if (!(await allowedOrganization(config))) return false
      // Parent permissions are checked by loadConfig before a claim. Exclusive
      // creation binds this grant to one call across processes/restarts.
      let handle
      try { handle = await open(claimPath(config, call), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) }
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
