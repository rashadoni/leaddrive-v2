import {
  chmodSync,
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"

const REGISTRY_KEY = "voiceAttemptRegistryEnabled"
const PAUSE_KEY = "outboundCallDispatchPaused"
const SAFE_BOOLEAN = new Set(["true", "false"])
const SAFE_SETTING = new Set(["registry", "pause"])

class OperatorError extends Error {}

export function parseEnvDocument(source) {
  const values = new Map()
  const counts = new Map()

  for (const originalLine of source.split(/\r?\n/u)) {
    const line = originalLine.trim()
    if (!line || line.startsWith("#")) continue

    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u)
    if (!match) continue

    const [, key] = match
    let value = match[2].trim()
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }

    values.set(key, value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return { values, counts }
}

export function assertUniqueEnvKeys(document, keys) {
  for (const key of keys) {
    if ((document.counts.get(key) ?? 0) > 1) {
      throw new OperatorError("A required production environment key is ambiguous")
    }
  }
}

function readBooleanSettingSnapshot(settings, key) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new OperatorError("The active Asterisk configuration is malformed")
  }

  const present = Object.prototype.hasOwnProperty.call(settings, key)
  const value = settings[key]
  if (present && typeof value !== "boolean") {
    throw new OperatorError("A stored voice cutover setting is not a boolean")
  }
  return { present, value: present ? value : null }
}

export function readRegistrySnapshot(settings) {
  return readBooleanSettingSnapshot(settings, REGISTRY_KEY)
}

export function readDispatchPauseSnapshot(settings) {
  return readBooleanSettingSnapshot(settings, PAUSE_KEY)
}

export function setRegistryCapability(settings, enabled) {
  readRegistrySnapshot(settings)
  return { ...settings, [REGISTRY_KEY]: enabled }
}

export function setDispatchPause(settings, enabled) {
  readDispatchPauseSnapshot(settings)
  return { ...settings, [PAUSE_KEY]: enabled }
}

export function restoreRegistryCapability(settings, snapshot) {
  readRegistrySnapshot(settings)
  const restored = { ...settings }
  if (snapshot.present) restored[REGISTRY_KEY] = snapshot.value
  else delete restored[REGISTRY_KEY]
  return restored
}

export function restoreDispatchPause(settings, snapshot) {
  readDispatchPauseSnapshot(settings)
  const restored = { ...settings }
  if (snapshot.present) restored[PAUSE_KEY] = snapshot.value
  else delete restored[PAUSE_KEY]
  return restored
}

function settingSnapshot(settings, setting) {
  return setting === "pause"
    ? readDispatchPauseSnapshot(settings)
    : readRegistrySnapshot(settings)
}

function setTechnicalSetting(settings, setting, enabled) {
  return setting === "pause"
    ? setDispatchPause(settings, enabled)
    : setRegistryCapability(settings, enabled)
}

function restoreTechnicalSetting(settings, setting, snapshot) {
  return setting === "pause"
    ? restoreDispatchPause(settings, snapshot)
    : restoreRegistryCapability(settings, snapshot)
}

export function classifyRegistryRollback(current, state) {
  const setting = state.setting ?? "registry"
  if (!SAFE_SETTING.has(setting)) {
    throw new OperatorError("The protected database rollback setting is invalid")
  }
  const currentSnapshot = settingSnapshot(current, setting)
  const alreadyRestored = (
    currentSnapshot.present === state.original.present
    && currentSnapshot.value === state.original.value
  )
  if (alreadyRestored) return "already_restored"
  if (currentSnapshot.present && currentSnapshot.value === state.target) return "restore"
  throw new OperatorError("The Asterisk configuration changed after cutover")
}

function envValue(document, key) {
  return document.values.get(key)?.trim() ?? ""
}

function isUnsafeAutomationEnabled(value) {
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase())
}

function readRuntimeInput() {
  const action = process.env.CUTOVER_ACTION?.trim()
  const setting = process.env.CUTOVER_SETTING?.trim() || "registry"
  const targetText = process.env.CUTOVER_TARGET?.trim()
  const envFile = process.env.CUTOVER_ENV_FILE?.trim()
  const stateFile = process.env.CUTOVER_STATE_FILE?.trim()
  const companionRegistryText = process.env.CUTOVER_COMPANION_REGISTRY?.trim() ?? ""

  if (!new Set(["apply", "rollback", "verify", "verify-capability"]).has(action)) {
    throw new OperatorError("The cutover action is invalid")
  }
  if (!SAFE_BOOLEAN.has(targetText)) {
    throw new OperatorError("The cutover target is invalid")
  }
  if (!SAFE_SETTING.has(setting)) {
    throw new OperatorError("The cutover setting is invalid")
  }
  if (companionRegistryText && !SAFE_BOOLEAN.has(companionRegistryText)) {
    throw new OperatorError("The companion registry state is invalid")
  }
  if (!envFile || !stateFile) {
    throw new OperatorError("The cutover file paths are missing")
  }

  const document = parseEnvDocument(readFileSync(envFile, "utf8"))
  assertUniqueEnvKeys(document, [
    "DATABASE_URL",
    "VOICE_AGENT_ORGANIZATION_ID",
    "VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED",
    "VOICE_OUTBOUND_CALL_DISPATCH_PAUSED",
    "VOICE_CALL_QUEUE_EXECUTION_ENABLED",
    "VOICE_PROVIDER_FINALITY_RECONCILIATION_ENABLED",
  ])

  const databaseUrl = envValue(document, "DATABASE_URL")
  const organizationId = envValue(document, "VOICE_AGENT_ORGANIZATION_ID")
  if (!databaseUrl || !organizationId) {
    throw new OperatorError("The production voice tenant or database is not configured")
  }
  if (
    isUnsafeAutomationEnabled(envValue(document, "VOICE_CALL_QUEUE_EXECUTION_ENABLED"))
    || isUnsafeAutomationEnabled(envValue(document, "VOICE_PROVIDER_FINALITY_RECONCILIATION_ENABLED"))
  ) {
    throw new OperatorError("Queue execution and finality reconciliation must remain disabled")
  }

  return {
    action,
    setting,
    target: targetText === "true",
    stateFile,
    document,
    databaseUrl,
    organizationId,
    companionRegistry: companionRegistryText ? companionRegistryText === "true" : null,
  }
}

function durableWriteJson(path, value) {
  const descriptor = openSync(path, "w", 0o600)
  try {
    writeFileSync(descriptor, `${JSON.stringify(value)}\n`, "utf8")
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  chmodSync(path, 0o600)

  // The rollback token must survive a host crash if the DB commit does.
  const directoryDescriptor = openSync(dirname(path), "r")
  try {
    fsyncSync(directoryDescriptor)
  } finally {
    closeSync(directoryDescriptor)
  }
}

function parseState(path) {
  let state
  try {
    state = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    throw new OperatorError("The protected database rollback state is unavailable")
  }
  if (
    !state
    || typeof state !== "object"
    || typeof state.organizationId !== "string"
    || typeof state.configId !== "string"
    || typeof state.target !== "boolean"
    || (state.setting !== undefined && !SAFE_SETTING.has(state.setting))
    || !state.original
    || typeof state.original.present !== "boolean"
    || (state.original.present && typeof state.original.value !== "boolean")
  ) {
    throw new OperatorError("The protected database rollback state is invalid")
  }
  return state
}

async function loadPrisma(databaseUrl) {
  process.env.DATABASE_URL = databaseUrl
  const { PrismaClient } = await import("@prisma/client")
  return new PrismaClient({ log: [] })
}

async function establishTenantLock(tx, organizationId) {
  await tx.$queryRawUnsafe(
    "SELECT set_config('app.org_id', $1, true)",
    organizationId,
  )
  // pg_advisory_xact_lock() returns void, and $queryRaw* tries to deserialize
  // that into a row set and throws. The same defect was fixed in the VoIP
  // config route, the outbound dispatch lock and the maintenance attestation;
  // this call site was missed, so every cutover stage failed here.
  await tx.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    // This is deliberately the same lock used by PUT /api/v1/voip/config.
    // Otherwise a tenant admin save could read stale settings before our row
    // lock, then overwrite the capability immediately after this transaction.
    `voip-config:${organizationId}`,
  )
}

async function selectActiveAsteriskRows(tx, organizationId) {
  return tx.$queryRawUnsafe(`
    SELECT id, settings
    FROM channel_configs
    WHERE "organizationId" = $1
      AND "channelType" = 'voip'
      AND "isActive" = true
      AND lower(coalesce(settings->>'provider', '')) = 'asterisk'
    ORDER BY id
    FOR UPDATE
  `, organizationId)
}

async function assertNoActiveVoiceCall(tx, organizationId) {
  const sessionRows = await tx.$queryRawUnsafe(`
    SELECT count(*)::int AS count
    FROM voice_call_sessions
    WHERE "organizationId" = $1
      AND "endedAt" IS NULL
      AND (
        "activeOrganizationKey" IS NOT NULL
        OR "activeLeadKey" IS NOT NULL
        OR "activePhoneKey" IS NOT NULL
      )
  `, organizationId)
  if (sessionRows.length !== 1 || Number(sessionRows[0].count) !== 0) {
    throw new OperatorError("An AI call is active or has uncertain delivery")
  }

  const callRows = await tx.$queryRawUnsafe(`
    SELECT count(*)::int AS count
    FROM call_logs
    WHERE "organizationId" = $1
      AND provider = 'asterisk'
      AND direction = 'outbound'
      AND "endedAt" IS NULL
      AND "providerOutcome" IS NULL
  `, organizationId)
  if (callRows.length !== 1 || Number(callRows[0].count) !== 0) {
    throw new OperatorError("An outbound Asterisk call is active or has uncertain delivery")
  }
}

async function updateSettings(tx, organizationId, configId, settings) {
  const changed = await tx.$executeRawUnsafe(`
    UPDATE channel_configs
    SET settings = $1::jsonb, "updatedAt" = now()
    WHERE id = $2
      AND "organizationId" = $3
      AND "channelType" = 'voip'
  `, JSON.stringify(settings), configId, organizationId)
  if (changed !== 1) {
    throw new OperatorError("The Asterisk configuration changed during cutover")
  }
}

async function applyCapability(prisma, runtime) {
  await prisma.$transaction(async (tx) => {
    await establishTenantLock(tx, runtime.organizationId)
    const rows = await selectActiveAsteriskRows(tx, runtime.organizationId)
    if (rows.length !== 1) {
      throw new OperatorError("Exactly one active Asterisk configuration is required")
    }
    await assertNoActiveVoiceCall(tx, runtime.organizationId)

    const row = rows[0]
    if (
      runtime.setting === "pause"
      && runtime.target === false
      && runtime.companionRegistry !== null
    ) {
      const registry = readRegistrySnapshot(row.settings)
      const registryEnabled = registry.present && registry.value === true
      if (registryEnabled !== runtime.companionRegistry) {
        throw new OperatorError("The registry and dispatch pause states do not match")
      }
    }
    const original = settingSnapshot(row.settings, runtime.setting)
    durableWriteJson(runtime.stateFile, {
      version: 1,
      setting: runtime.setting,
      organizationId: runtime.organizationId,
      configId: row.id,
      target: runtime.target,
      original,
    })
    await updateSettings(
      tx,
      runtime.organizationId,
      row.id,
      setTechnicalSetting(row.settings, runtime.setting, runtime.target),
    )
  })
}

async function rollbackCapability(prisma, runtime) {
  const state = parseState(runtime.stateFile)
  const stateSetting = state.setting ?? "registry"
  if (
    state.organizationId !== runtime.organizationId
    || state.target !== runtime.target
    || stateSetting !== runtime.setting
  ) {
    throw new OperatorError("The protected database rollback state does not match this operation")
  }

  await prisma.$transaction(async (tx) => {
    await establishTenantLock(tx, runtime.organizationId)
    const rows = await tx.$queryRawUnsafe(`
      SELECT id, settings
      FROM channel_configs
      WHERE id = $1
        AND "organizationId" = $2
        AND "channelType" = 'voip'
        AND "isActive" = true
        AND lower(coalesce(settings->>'provider', '')) = 'asterisk'
      FOR UPDATE
    `, state.configId, runtime.organizationId)
    if (rows.length !== 1) {
      throw new OperatorError("The Asterisk configuration cannot be restored automatically")
    }

    if (classifyRegistryRollback(rows[0].settings, state) === "already_restored") return
    await updateSettings(
      tx,
      runtime.organizationId,
      state.configId,
      restoreTechnicalSetting(rows[0].settings, stateSetting, state.original),
    )
  })
}

async function verifyCapability(prisma, runtime, options = { verifyEnvironment: true }) {
  if (options.verifyEnvironment) {
    const environmentKey = runtime.setting === "pause"
      ? "VOICE_OUTBOUND_CALL_DISPATCH_PAUSED"
      : "VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED"
    // An absent gate is the pre-cutover state and means false, exactly as the
    // shell helpers treat it. Demanding the literal string made every check
    // fail on a host whose gates have never been written.
    const raw = envValue(runtime.document, environmentKey).toLowerCase()
    const environmentValue = raw === "" ? "false" : raw
    if (environmentValue !== String(runtime.target)) {
      throw new OperatorError("The production environment flag does not match the requested state")
    }
  }

  await prisma.$transaction(async (tx) => {
    await establishTenantLock(tx, runtime.organizationId)
    const rows = await selectActiveAsteriskRows(tx, runtime.organizationId)
    if (rows.length !== 1) {
      throw new OperatorError("Exactly one active Asterisk configuration is required")
    }
    const current = settingSnapshot(rows[0].settings, runtime.setting)
    // A technical setting that was never written is off. Requiring the key to
    // be present made "verify that this is disabled" impossible to satisfy on
    // a tenant that had never been through a cutover, which is exactly the
    // state every first cutover starts from -- and it broke resume, leaving
    // dispatch paused with no supported way back.
    const effective = current.present ? current.value : false
    if (effective !== runtime.target) {
      throw new OperatorError(
        `The database capability is ${current.present ? String(current.value) : "unset"}`
        + `, expected ${String(runtime.target)}`,
      )
    }
    await assertNoActiveVoiceCall(tx, runtime.organizationId)
  })
}

export async function main() {
  const runtime = readRuntimeInput()
  const prisma = await loadPrisma(runtime.databaseUrl)
  try {
    if (runtime.action === "apply") await applyCapability(prisma, runtime)
    else if (runtime.action === "rollback") await rollbackCapability(prisma, runtime)
    else if (runtime.action === "verify") await verifyCapability(prisma, runtime)
    else await verifyCapability(prisma, runtime, { verifyEnvironment: false })
  } finally {
    await prisma.$disconnect().catch(() => undefined)
  }
}

const invokedDirectly = process.argv[1]
  && new URL(import.meta.url).pathname === process.argv[1]

if (invokedDirectly) {
  main().catch((error) => {
    // An unexpected error used to surface as one generic sentence with no way
    // to tell a connection problem from a driver problem. The error's type and
    // code are enough to point at the cause and carry no query parameters.
    const message = error instanceof OperatorError
      ? error.message
      : `The database cutover operation failed (${error?.name || "Error"}`
        + `${error?.code ? ` ${error.code}` : ""})`
    console.error(`FATAL: ${message}`)
    process.exitCode = 1
  })
}
