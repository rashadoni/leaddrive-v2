import { constants } from "node:fs"
import { open } from "node:fs/promises"
import { dirname, join } from "node:path"
import { runWithTenant } from "../../rls-context"
import { readPrivate } from "./zeytun-private-file"
import { ZeytunAvailableBalances } from "./zeytun-available-balances"
import { createDepartedSearch } from "./zeytun-departed-items"
import { ZeytunSnapshotStore } from "./zeytun-snapshot-store"
import { inboundPilotConfigSchema, inboundPilotDigest, isLineGrant, phoneOrderCatalog, type InboundPilotCall, type InboundPilotConfig, type InboundPilotDependencies,
  type InboundPilotOrderCall } from "./zeytun-inbound-pilot"
import type { ZeytunCallDatabase } from "./zeytun-call-loader"
import { cancelPhoneOrderFromCall, confirmedPhoneOrderLines, orderedPhoneOrderProducts, savePhoneOrderFromCall } from "./phone-orders"
import { requestAiHandoff } from "../../voip/inbound-handoff"
import { ZeytunClientsDirectory } from "./zeytun-clients-directory"
import { identifyPharmacy, matchPharmacyName, pharmacyHintWords, type PharmacyCandidate,
  type PharmacyIdentity } from "./zeytun-pharmacy-identity"
import { readLineSpeech } from "./zeytun-line-speech"
import { learnNames, type LearnedNames } from "./zeytun-learned-names"
import { callPharmacy, lastPharmacyOrder } from "./zeytun-pharmacy-history"
import { markWaitlistArrivals, pharmacyArrivals, recordCallWaitlist } from "./zeytun-waitlist"
import { recoveredOrderLines } from "./zeytun-transcript-recovery"
import { CALLBACK_MARKER, callbackMarker } from "./zeytun-waitlist-callback"
import { combineAssortment, confirmedOrdersSource, createCallAssortments, type AssortmentSource,
  type LoadedAssortment } from "./zeytun-pharmacy-assortment"
import { salesHistorySource } from "./zeytun-sales-history"
import { CHIRP_KEY_FILE, createChirpRecognizer, createZeytunSecondEar, type ZeytunSecondEar } from "./zeytun-chirp"
import { journalPlatformAiCall } from "@/lib/ai/gateway/access"
import { perMinuteCostUsd, UNIT_PRICING } from "@/lib/ai/gateway/pricing"
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
/** How far back confirmed orders teach the line, and how long one reading of them is used. */
const LEARNED_SINCE_MS = 365 * 24 * 60 * 60_000, LEARNED_FOR_MS = 10 * 60_000, LEARNED_MAX_LINES = 20_000
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
  /** Tell the managers and the pharmacy about an order the station delivered
   * after the call ended (call-lifecycle did it at the end, without it). */
  announceOrder?: (organizationId: string, providerCallId: string) => Promise<unknown>
  /** An organization's settings (Organization.settings); the line reads its own speech there. */
  organizationSettings?: (organizationId: string) => Promise<unknown>
  /** Replaces the second ear read from the key file next to the grant (tests). */
  secondEar?: ZeytunSecondEar
}): InboundPilotDependencies {
  // Owner 2026-11-04 («Да, встраивай»): Chirp next to the model. Its key is a
  // private file beside the grant; without it the ear is off.
  const secondEar = options.secondEar ?? (options.configFile
    ? createZeytunSecondEar({ recognizer: createChirpRecognizer({ keyFile: join(dirname(options.configFile), CHIRP_KEY_FILE) }) }) : undefined)
  // The rehearsal belongs to the installation's default organization. The
  // line runs where its number is: owner, 2026-10-26 («переноси линию Зейтуна
  // в его организацию»), the number assigned to Zeytun with its own channel.
  const allowedOrganization = async (config: InboundPilotConfig) => config.organizationId === options.runtimeOrganizationId
    || (isLineGrant(config) && Boolean(options.holdsLine) && await options.holdsLine!(config.organizationId, config.channelConfigId))
  let catalog: { key: string; at: number; value: ReturnType<InboundPilotDependencies["loadCatalog"]>; next?: Promise<void> } | null = null
  const learned = new Map<string, { at: number; value: LearnedNames | null; loading: boolean }>()
  // Owner, 2026-11-03 («товаров 9к»): the line learns from the orders its
  // managers confirmed and hints the products pharmacies ask for. Read in the
  // background, never on a spoken request: until the first reading is there,
  // the line searches as before. The catalog load starts it too, so the warm-up
  // cron has it ready for the first call after a restart.
  function learnedFor(config: InboundPilotConfig): LearnedNames | null {
    const orgId = config.orderOrganizationId
    if (!options.orders || !isLineGrant(config) || !orgId) return null
    const key = `${orgId}:${config.approvedSource.scopeKey}`
    const known = learned.get(key)
    if (!known || (!known.loading && Date.now() - known.at >= LEARNED_FOR_MS)) {
      const entry = known ?? { at: 0, value: null as LearnedNames | null, loading: false }
      entry.loading = true
      learned.set(key, entry)
      const scope = { organizationId: orgId, catalogScopeKey: config.approvedSource.scopeKey,
        since: new Date(Date.now() - LEARNED_SINCE_MS), limit: LEARNED_MAX_LINES }
      void Promise.all([confirmedPhoneOrderLines(options.orders, scope), orderedPhoneOrderProducts(options.orders, scope)])
        .then(([lines, ordered]) => {
          entry.value = learnNames(lines, ordered)
          console.log("[zeytun-line] learned", JSON.stringify({ lines: lines.length, ordered: ordered.length }))
        }).catch(() => undefined).finally(() => { entry.at = Date.now(); entry.loading = false })
    }
    return known?.value ?? null
  }
  // The pharmacy list is small (~1 200 rows, ~0.1 s to parse): re-read when
  // its header changes, looked at no more than once a minute.
  let pharmacies: { key: string; version: string; at: number; directory: ZeytunClientsDirectory
    /** The whole list for matching a name said on the call, and its words for the second ear: worked out once per version. */
    all?: PharmacyCandidate[]; hints?: string[] } | null = null
  /** The pharmacy list as read last (findPharmacies keeps it fresh): never read here, so never waits. */
  function knownPharmacies(config: InboundPilotConfig): { all: PharmacyCandidate[]; hints: string[] } | null {
    if (!isLineGrant(config) || !config.pharmacySource || !pharmacies) return null
    const source = config.pharmacySource
    if (pharmacies.key !== `${source.organizationId}:${source.scopeKey}`) return null
    const summary = pharmacies.directory.summary(source.organizationId)
    if (summary.source !== "live" || Date.now() - Date.parse(summary.observedAt) > PHARMACY_DIRECTORY_MAX_AGE_MS) return null
    pharmacies.all ??= pharmacies.directory.all(source.organizationId)
      .map((client) => ({ guid: client.counterpartyGuid, name: client.name, address: client.address || null }))
    pharmacies.hints ??= pharmacyHintWords(pharmacies.all.map((pharmacy) => pharmacy.name))
    return { all: pharmacies.all, hints: pharmacies.hints }
  }
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
  // What the calling pharmacy orders (owner 2026-11-04, «слух по истории аптеки»): read once
  // when the call starts, in the background, and again if the call's order names another pharmacy.
  const assortments = createCallAssortments()
  // The CRM's confirmed phone orders first, then what 1C sold the pharmacy (zeytun-sales-history.ts, read by its own job).
  const assortmentSources: AssortmentSource[] = options.orders
    ? [confirmedOrdersSource(options.orders), ...(options.snapshotDirectory ? [salesHistorySource(options.snapshotDirectory)] : [])] : []
  async function loadAssortment(config: InboundPilotConfig, call: InboundPilotOrderCall): Promise<LoadedAssortment> {
    const orgId = config.orderOrganizationId
    if (!options.orders || !isLineGrant(config) || !orgId || !assortmentSources.length || !(await allowedOrganization(config))) {
      return { pharmacy: "none", assortment: null }
    }
    const byNumber = await findPharmacies(config, callerNumber(call.fromNumber)).catch(() => [])
    const { pharmacy } = await callPharmacy(options.orders, { organizationId: orgId, providerCallId: call.providerCallId,
      numberPharmacyGuid: byNumber.length === 1 ? byNumber[0].guid : null })
    if (!pharmacy) return { pharmacy: "none", assortment: null }
    const lists = await Promise.all(assortmentSources.map(async (source) => ({ source: source.name,
      products: await source.products({ organizationId: orgId, catalogScopeKey: config.approvedSource.scopeKey, pharmacy }).catch(() => []) })))
    const assortment = combineAssortment(lists)
    // How many products and from where, never which: the call's station id, as the search log.
    console.log("[zeytun-line] assortment", JSON.stringify({ call: call.providerCallId, products: assortment?.ordered.length ?? 0,
      sources: assortment?.sources ?? [] }))
    return { pharmacy: pharmacy.guid ?? pharmacy.companyId ?? "none", assortment }
  }
  // The rehearsal binds its grant to one call; the line claims each call apart.
  const claimPath = (config: InboundPilotConfig, call: InboundPilotOrderCall) => join(dirname(options.configFile),
    isLineGrant(config) ? `line-${config.id}-${call.providerCallId}.claim` : `inbound-${config.id}.claim`)
  const claimValue = (config: InboundPilotConfig, call: InboundPilotOrderCall) => ({
    grantDigest: inboundPilotDigest(config), callId: call.providerCallId, callLogId: call.id,
  })
  const isClaimed = async (config: InboundPilotConfig, call: InboundPilotOrderCall) => {
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
  // The pilot's caller is the owner's test participant: the order is
  // marked a test call and names no pharmacy (shared numbers in 1C cannot
  // identify one). The number is the grant's, which the call matched.
  const saveFromCall = async (config: InboundPilotConfig & { orderOrganizationId: string }, call: InboundPilotOrderCall,
    base: Omit<Parameters<typeof savePhoneOrderFromCall>[1], "callerPhoneE164" | "identification">, pharmacy?: string) => {
    if (!isLineGrant(config)) {
      return savePhoneOrderFromCall(options.orders!, { ...base, callerPhoneE164: config.testPhoneE164, identification: "test_call" })
    }
    // The 1C pharmacy when the number names one the caller did not
    // contradict, or the one of a shared number the caller named; a name
    // matching nothing in 1C is kept as said, never as a 1C pharmacy.
    const caller = callerNumber(call.fromNumber)
    let identity: PharmacyIdentity = identifyPharmacy(await findPharmacies(config, caller).catch(() => []), pharmacy)
    // Not the number's pharmacy: the words may still name one of 1C's by its number and district
    // ("92 Yasamal"), as the agent wrote them or as the second ear heard a phrase with "aptek".
    // The manager checks it; it is never the call's own pharmacy (callPharmacy).
    if (identity.identification === "named_on_call" || identity.identification === "unidentified") {
      const list = knownPharmacies(config)
      const heard = secondEar?.pharmacyHeard(call.providerCallId) ?? []
      const matched = list ? matchPharmacyName([...(pharmacy ? [pharmacy] : []), ...heard], list.all) : null
      if (matched) identity = { identification: "named_matched", pharmacy: matched, spoken: pharmacy?.trim() || matched.name }
    }
    // The agent saves after every line; the managers hear of the order
    // when the call ends (call-lifecycle → announceCallOrder).
    const saved = await savePhoneOrderFromCall(options.orders!, { ...base, callerPhoneE164: caller, identification: identity.identification,
      ...("pharmacy" in identity
        ? { pharmacyName: identity.pharmacy.name, pharmacyGuid: identity.pharmacy.guid, pharmacyAddress: identity.pharmacy.address }
        : "spoken" in identity ? { pharmacyName: identity.spoken } : {}) })
    // The caller named another pharmacy than the one its list was read for: that list is no longer the call's.
    const own = identity.identification === "phone_unique" || identity.identification === "phone_shared" ? identity.pharmacy.guid : "none"
    assortments.refresh(call.providerCallId, own, () => loadAssortment(config, call))
    return saved
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
        return tx.$queryRaw<Array<Omit<InboundPilotCall, "startedAt" | "endedAt"> & { startedAt: Date; endedAt: Date | null }>>`
          WITH candidates AS (
            SELECT id, "organizationId", "channelConfigId", "providerCallId", provider, direction, "callMode", status,
              "wasAnswered", "endedAt", "startedAt", "fromNumber", "targetPhoneE164", "handoffState",
              "consentAudit"->'pharmacyWaitlistCallback' AS "callbackMarker"
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
      const endedAt = rows[0].endedAt
      return { ...rows[0], startedAt: rows[0].startedAt.toISOString(), endedAt: endedAt instanceof Date ? endedAt.toISOString() : endedAt }
    },
    async loadCatalog(config) {
      learnedFor(config)
      const key = inboundPilotDigest(config)
      const load = () => (async () => {
        const source = config.approvedSource
        const store = new ZeytunSnapshotStore(options.snapshotDirectory, source.organizationId, source.scopeKey)
        const snapshot = await store.load()
        // The rehearsal is pinned to the version the owner approved; the line
        // takes the newest live snapshot the refresh cron saved.
        if (!snapshot || (!isLineGrant(config) && snapshot.version !== config.approvedSource.catalogVersion)) throw new Error("snapshot_unavailable")
        const feed = await ZeytunAvailableBalances.build(snapshot.payload, snapshot.context)
        // Sold out lately: the line only; a list that cannot be read is no list, never a failed catalog.
        const departed = isLineGrant(config) ? createDepartedSearch(await store.loadDeparted().catch(() => [])) : null
        // Back in stock lately, for the pharmacies that wait for or order it (zeytun-waitlist.ts); the line only.
        const arrived = isLineGrant(config) ? await store.loadArrived().catch(() => []) : []
        // No catalog words go to the recognizer: 2026-11-03 the maker hints
        // ("Abdi", "Sopharma"…) turned "Adefa" into "Abdi İbrahim", in the
        // transcript and in the agent's own search. Callers name products;
        // the search already finds Adefa from Adexa, Adelfa or Adesa.
        return { organizationId: source.organizationId, scopeKey: source.scopeKey, version: snapshot.version,
          observedAt: snapshot.context.observedAt, source: snapshot.context.source,
          search: (query: Parameters<ZeytunAvailableBalances["search"]>[1], options?: { assortment?: { ordered: readonly string[] } | null }) =>
            feed.search(source.organizationId, query, undefined, options),
          ...(departed?.size ? { departed } : {}), ...(arrived.length ? { arrived } : {}) }
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
      // takes its new date without a rebuild (~3 s of this process's CPU, in
      // slices: ZeytunAvailableBalances.build).
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
    ...(secondEar ? {
      secondEar,
      // Chirp runs on the platform's service account; the phrase is still the organization's spend.
      journalHearing: (organizationId: string, seconds: number) => journalPlatformAiCall(organizationId, "google_speech", "phone-line",
        { model: "chirp_3", costUsd: perMinuteCostUsd(UNIT_PRICING.chirpMinute, seconds) }),
    } : {}),
    ...(options.organizationSettings ? {
      // Owner, 2026-10-31: the organization edits its line's greeting, goodbye and notes itself.
      loadLineSpeech: async (config) => config.orderOrganizationId && await allowedOrganization(config)
        ? readLineSpeech(await options.organizationSettings!(config.orderOrganizationId)) : readLineSpeech(null),
    } satisfies Pick<InboundPilotDependencies, "loadLineSpeech"> : {}),
    ...(options.orders ? {
      saveOrder: async (config, call, catalog, lines, pharmacy, delivery) => {
        const base = { organizationId: config.orderOrganizationId, providerCallId: call.providerCallId,
          callStartedAt: call.startedAt, catalog, lines, seq: delivery?.seq, afterCall: delivery?.afterCall === true, final: delivery?.final === true }
        const saved = await saveFromCall(config, call, base, pharmacy)
        // The waiting list follows the list the call holds now; a failure costs the order nothing.
        if (delivery?.waiting && saved.status === "saved" && saved.changed && isLineGrant(config)) {
          await recordCallWaitlist(options.orders!, { organizationId: config.orderOrganizationId, providerCallId: call.providerCallId,
            catalogScopeKey: catalog.scopeKey, lines: delivery.waiting })
            .catch((error: unknown) => console.warn("[zeytun-line] waitlist not saved", error instanceof Error ? error.name : typeof error))
        }
        // The end of the call announced the order as it was then (or found
        // none): a list delivered later is announced again, as it now is; so
        // is a late final save, which only now lets the pharmacy hear of it.
        if (base.afterCall && saved.status === "saved" && (saved.changed || base.final) && options.announceOrder) {
          void options.announceOrder(config.orderOrganizationId, call.providerCallId)
            .catch((error: unknown) => console.warn("[zeytun-line] late order notice failed", error instanceof Error ? error.name : typeof error))
        }
        return saved
      },
      // Owner's call 2026-10-31: the pharmacy cancels its own order on the line.
      cancelOrder: async (config, call, seq) => {
        if (!isLineGrant(config) || !(await allowedOrganization(config))) return "already_reviewed"
        const result = await cancelPhoneOrderFromCall(options.orders!, { organizationId: config.orderOrganizationId,
          providerCallId: call.providerCallId, seq })
        return result.status
      },
    } satisfies Pick<InboundPilotDependencies, "saveOrder" | "cancelOrder"> : {}),
    ...(options.orders ? { learnedNames: learnedFor } satisfies Pick<InboundPilotDependencies, "learnedNames"> : {}),
    ...(options.orders ? {
      pharmacyAssortment: (config, call) => assortments.get(call.providerCallId, () => loadAssortment(config, call)),
    } satisfies Pick<InboundPilotDependencies, "pharmacyAssortment"> : {}),
    pharmacyHints: (config) => knownPharmacies(config)?.hints ?? [],
    /**
     * Task 1b of the owner's queue (2026-11-06): the call is over and its order is
     * unfinished (no final save) or missing; what the transcript says the pharmacy
     * ordered and the order lacks is added for a manager, from the transcript.
     */
    async recoverOrderFromTranscript(providerCallId, transcript, read) {
      if (!options.orders || !transcript.trim()) return { status: "skipped" }
      const parsed = inboundPilotConfigSchema.safeParse(await this.loadConfig())
      if (!parsed.success || !isLineGrant(parsed.data) || !parsed.data.orderOrganizationId || !(await allowedOrganization(parsed.data))) {
        return { status: "skipped" }
      }
      const config = parsed.data as typeof parsed.data & { orderOrganizationId: string }
      const raw = await this.loadCall(config, providerCallId) as (Omit<InboundPilotOrderCall, "direction"> & { direction: string }) | null
      // The line's own call back to a pharmacy (task 10) reads as the pharmacy's call: its number is the target.
      const callback = raw?.direction === "outbound" ? callbackMarker({ [CALLBACK_MARKER]: raw.callbackMarker }, providerCallId) : null
      if (!raw || (raw.direction !== "inbound" && !callback)) return { status: "no_call" }
      const call = (callback ? { ...raw, direction: "inbound", fromNumber: raw.targetPhoneE164, targetPhoneE164: raw.fromNumber } : raw) as InboundPilotOrderCall
      const orgId = config.orderOrganizationId
      const order = await runWithTenant(orgId, () => options.orders!.pharmacyPhoneOrder.findUnique({
        where: { organizationId_providerCallId: { organizationId: orgId, providerCallId } },
        select: { status: true, finishedOnCallAt: true, erpState: true, revision: true, stationRevision: true,
          lines: { orderBy: { position: "asc" }, select: { spokenText: true, productName: true, externalId: true, quantity: true, unit: true } } },
      }))
      if (order && (order.status !== "pending_review" || order.finishedOnCallAt || order.erpState !== null || order.revision !== order.stationRevision)) {
        return { status: "not_needed" }
      }
      const lines = await read(transcript, orgId)
      if (!lines?.length) return { status: "nothing_read" }
      const catalog = await this.loadCatalog(config)
      const merged = recoveredOrderLines(order?.lines ?? [], lines,
        (name) => catalog.search({ text: name }).candidates[0]?.externalId ?? null)
      if (!merged) return { status: "nothing_new" }
      const saved = await saveFromCall(config, call, { organizationId: orgId, providerCallId, callStartedAt: call.startedAt,
        catalog: phoneOrderCatalog(catalog), lines: merged, afterCall: true })
      if (saved.status !== "saved") return { status: saved.status }
      if (saved.changed && options.announceOrder) {
        void options.announceOrder(orgId, providerCallId)
          .catch((error: unknown) => console.warn("[zeytun-line] transcript order notice failed", error instanceof Error ? error.name : typeof error))
      }
      return { status: "saved", added: merged.length - (order?.lines.length ?? 0) }
    },
    /** Stamps the waiting list's products 1C has again (warmZeytunLine, after each catalog refresh). */
    async markWaitlistArrivals(config: InboundPilotConfig): Promise<number> {
      if (!options.orders || !isLineGrant(config) || !config.orderOrganizationId || !(await allowedOrganization(config))) return 0
      const catalog = await this.loadCatalog(config)
      return markWaitlistArrivals(options.orders, { organizationId: config.orderOrganizationId, catalogScopeKey: catalog.scopeKey,
        inStock: (externalId) => catalog.search({ externalId }).candidates.some(candidate => candidate.externalId === externalId) })
    },
    ...(options.orders ? {
      // Owner's client, 2026-11-06: «есть новые поступления, хотите ли узнать?» — what this pharmacy waited for or orders.
      pharmacyArrivals: async (config, call, catalog, numberPharmacyGuid) => {
        if (!(await allowedOrganization(config))) return []
        return pharmacyArrivals(options.orders!, { organizationId: config.orderOrganizationId, providerCallId: call.providerCallId,
          callStartedAt: call.startedAt, numberPharmacyGuid, catalogScopeKey: catalog.scopeKey, arrived: catalog.arrived ?? [],
          inStock: (externalId) => {
            const item = catalog.search({ externalId }).candidates.find(candidate => candidate.externalId === externalId)
            return item ? { name: item.nameAz?.trim() || item.name } : null
          } })
      },
    } satisfies Pick<InboundPilotDependencies, "pharmacyArrivals"> : {}),
    ...(options.orders ? {
      // «Как обычно» (owner, 2026-11-04): the pharmacy the call already knows —
      // its order's, or before the first save the one 1C has for this number alone.
      pharmacyHistory: async (config, call) => {
        if (!(await allowedOrganization(config))) return { status: "pharmacy_unknown" }
        const byNumber = await findPharmacies(config, callerNumber(call.fromNumber)).catch(() => [])
        return lastPharmacyOrder(options.orders!, { organizationId: config.orderOrganizationId, providerCallId: call.providerCallId,
          numberPharmacyGuid: byNumber.length === 1 ? byNumber[0].guid : null })
      },
    } satisfies Pick<InboundPilotDependencies, "pharmacyHistory"> : {}),
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
