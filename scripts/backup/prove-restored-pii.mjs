#!/usr/bin/env node

// Offline-only semantic recovery proof. It reads the restored app.env key and
// candidate ciphertexts in memory, emits no value/tenant/row identifier, and
// succeeds only when at least one real restored PII value authenticates under
// the production TENANT_PII_MASTER_KEY and its table/column-bound AAD.

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { createDecipheriv, createHash, createHmac, hkdfSync } from "node:crypto"

const keyFile = process.env.TENANT_PII_MASTER_KEY_FILE
if (!keyFile) {
  throw new Error("TENANT_PII_MASTER_KEY_FILE is required")
}

function readUniqueEnvValue(file, target) {
  let match
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/u)) {
    let line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    if (line.startsWith("export ")) line = line.slice(7).trim()
    const parsed = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line)
    if (!parsed || parsed[1] !== target) continue
    if (match !== undefined) throw new Error(`${target} appears more than once`)
    let value = parsed[2].trim()
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    match = value
  }
  return match
}

const masterKeyHex = readUniqueEnvValue(keyFile, "TENANT_PII_MASTER_KEY")
if (!masterKeyHex || !/^[0-9a-fA-F]{64}$/u.test(masterKeyHex)) {
  throw new Error("restored secret snapshot has no valid TENANT_PII_MASTER_KEY")
}
const masterKey = Buffer.from(masterKeyHex, "hex")
const nextAuthSecret = readUniqueEnvValue(keyFile, "NEXTAUTH_SECRET")
if (!nextAuthSecret || nextAuthSecret.length < 32) {
  throw new Error("restored secret snapshot has no sufficiently strong NEXTAUTH_SECRET")
}

const sql = String.raw`
(SELECT 'policy_holders', 'fullName', "organizationId", "fullName" FROM public.policy_holders
  WHERE "fullName" ~ '^[A-Za-z0-9+/]+={0,2}$' AND length("fullName") >= 40 LIMIT 50)
UNION ALL
(SELECT 'citizens', 'fullName', "organizationId", "fullName" FROM public.citizens
  WHERE "fullName" ~ '^[A-Za-z0-9+/]+={0,2}$' AND length("fullName") >= 40 LIMIT 50)
UNION ALL
(SELECT 'health_patients', 'fullName', "organizationId", "fullName" FROM public.health_patients
  WHERE "fullName" ~ '^[A-Za-z0-9+/]+={0,2}$' AND length("fullName") >= 40 LIMIT 50)
UNION ALL
(SELECT 'health_providers', 'fullName', "organizationId", "fullName" FROM public.health_providers
  WHERE "fullName" ~ '^[A-Za-z0-9+/]+={0,2}$' AND length("fullName") >= 40 LIMIT 50)
UNION ALL
(SELECT 'insurance_service_team_members', 'fullName', "organizationId", "fullName" FROM public.insurance_service_team_members
  WHERE "fullName" ~ '^[A-Za-z0-9+/]+={0,2}$' AND length("fullName") >= 40 LIMIT 50)
UNION ALL
(SELECT 'public_sector_officials', 'fullName', "organizationId", "fullName" FROM public.public_sector_officials
  WHERE "fullName" ~ '^[A-Za-z0-9+/]+={0,2}$' AND length("fullName") >= 40 LIMIT 50)
UNION ALL
(SELECT 'media_subscribers', 'displayName', "organizationId", "displayName" FROM public.media_subscribers
  WHERE "displayName" ~ '^[A-Za-z0-9+/]+={0,2}$' AND length("displayName") >= 40 LIMIT 50)
UNION ALL
(SELECT 'utility_customers', 'accountHolderName', "organizationId", "accountHolderName" FROM public.utility_customers
  WHERE "accountHolderName" ~ '^[A-Za-z0-9+/]+={0,2}$' AND length("accountHolderName") >= 40 LIMIT 50)
UNION ALL
(SELECT 'service_calls', 'subject', "organizationId", "subject" FROM public.service_calls
  WHERE "subject" ~ '^[A-Za-z0-9+/]+={0,2}$' AND length("subject") >= 40 LIMIT 50)
UNION ALL
(SELECT 'beneficiaries', 'fullName', "organizationId", "fullName" FROM public.beneficiaries
  WHERE "fullName" ~ '^[A-Za-z0-9+/]+={0,2}$' AND length("fullName") >= 40 LIMIT 50);
`

const query = spawnSync(
  "psql",
  ["-X", "-v", "ON_ERROR_STOP=1", "-AtF", "\t", "-c", sql],
  {
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: "-c app.rls_bypass=on" },
    maxBuffer: 4 * 1024 * 1024,
  },
)
if (query.status !== 0) {
  throw new Error("cannot read bounded PII recovery candidates from scratch database")
}

function decryptCandidate(orgId, table, column, encoded, aad) {
  if (!/^[A-Za-z0-9+/]+=*$/u.test(encoded)) return undefined
  const wire = Buffer.from(encoded, "base64")
  if (wire.length < 29) return undefined
  const iv = wire.subarray(0, 12)
  const tag = wire.subarray(wire.length - 16)
  const ciphertext = wire.subarray(12, wire.length - 16)
  const dek = Buffer.from(hkdfSync(
    "sha256",
    masterKey,
    Buffer.from(orgId, "utf8"),
    "leaddrive-tenant-pii-v1",
    32,
  ))
  const decipher = createDecipheriv("aes-256-gcm", dek, iv)
  decipher.setAAD(Buffer.from(aad(table, column, orgId), "utf8"))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}

let piiPassed = false
for (const line of query.stdout.split("\n")) {
  if (!line) continue
  const fields = line.split("\t")
  if (fields.length !== 4) continue
  const [table, column, orgId, ciphertext] = fields
  for (const aad of [
    (tableName, columnName, tenant) => `${tenant}|${tableName}|${columnName}`,
    (_tableName, _columnName, tenant) => tenant,
  ]) {
    try {
      const plaintext = decryptCandidate(orgId, table, column, ciphertext, aad)
      if (typeof plaintext === "string" && plaintext.length > 0 && plaintext !== ciphertext) {
        process.stdout.write(`[pii-restore-proof] encrypted PII decrypt passed (${table}.${column}; value redacted)\n`)
        piiPassed = true
        break
      }
    } catch {
      // Try the legacy AAD form or the next bounded candidate. Never print the
      // authentication error because it can contain operational context.
    }
  }
  if (piiPassed) break
}

if (!piiPassed) {
  throw new Error("no restored encrypted PII value authenticated with the recovered master key")
}

// Every persisted secure-token location must appear in both queries below.
// The inventory is intentionally independent from the bounded candidate set:
// an existing ciphertext can therefore never disappear behind a false N/A.
const tokenInventorySql = String.raw`
WITH token_inventory AS (
  SELECT 'monitoring-provider'::text AS token_class
    FROM public.monitoring_sources
   WHERE settings #>> '{provider,encryptedToken}' LIKE 'v1:%'
  UNION ALL
  SELECT 'monitoring-provider-reply'
    FROM public.monitoring_sources
   WHERE settings #>> '{provider,reply,encryptedToken}' LIKE 'v1:%'
  UNION ALL
  SELECT 'monitoring-search-index'
    FROM public.monitoring_sources
   WHERE settings #>> '{searchIndex,encryptedToken}' LIKE 'v1:%'
  UNION ALL
  SELECT 'google-alerts-rss'
    FROM public.monitoring_sources
   WHERE settings #>> '{googleAlertsRss,encryptedFeedUrl}' LIKE 'v1:%'
  UNION ALL
  SELECT 'channel-search-index'
    FROM public.channel_configs
   WHERE "channelType" = 'social_monitoring' AND "apiKey" LIKE 'v1:%'
  UNION ALL
  SELECT 'social-account:' || COALESCE(NULLIF(platform, ''), '__missing_platform__')
    FROM public.social_accounts
   WHERE "accessToken" LIKE 'v1:%'
)
SELECT json_build_array(token_class, count(*))::text
  FROM token_inventory
 GROUP BY token_class
 ORDER BY token_class;
`

const tokenInventoryQuery = spawnSync(
  "psql",
  ["-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", tokenInventorySql],
  {
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: "-c app.rls_bypass=on" },
    maxBuffer: 2 * 1024 * 1024,
  },
)
if (tokenInventoryQuery.status !== 0) {
  throw new Error("cannot inventory restored encrypted integration tokens")
}

const tokenInventory = new Map()
for (const line of tokenInventoryQuery.stdout.split("\n")) {
  if (!line) continue
  let parsed
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new Error("integration-token inventory returned malformed data")
  }
  if (
    !Array.isArray(parsed)
    || parsed.length !== 2
    || typeof parsed[0] !== "string"
    || !Number.isSafeInteger(Number(parsed[1]))
    || Number(parsed[1]) <= 0
    || tokenInventory.has(parsed[0])
  ) {
    throw new Error("integration-token inventory violated its recovery contract")
  }
  tokenInventory.set(parsed[0], Number(parsed[1]))
}

const tokenCandidatesSql = String.raw`
WITH raw_token_candidates AS (
  SELECT
    'monitoring-provider'::text AS token_class,
    'social-provider:' || id AS purpose_one,
    'social-provider'::text AS purpose_two,
    NULL::text AS purpose_three,
    settings #>> '{provider,encryptedToken}' AS ciphertext
  FROM public.monitoring_sources
  WHERE settings #>> '{provider,encryptedToken}' LIKE 'v1:%'

  UNION ALL
  SELECT
    'monitoring-provider-reply',
    'social-provider-reply',
    NULL,
    NULL,
    settings #>> '{provider,reply,encryptedToken}'
  FROM public.monitoring_sources
  WHERE settings #>> '{provider,reply,encryptedToken}' LIKE 'v1:%'

  UNION ALL
  SELECT
    'monitoring-search-index',
    NULLIF(settings #>> '{searchIndex,tokenPurpose}', ''),
    'social-search-index:' || "organizationId",
    'social-search-index:' || id,
    settings #>> '{searchIndex,encryptedToken}'
  FROM public.monitoring_sources
  WHERE settings #>> '{searchIndex,encryptedToken}' LIKE 'v1:%'

  UNION ALL
  SELECT
    'google-alerts-rss',
    CASE
      WHEN COALESCE(
        NULLIF(settings #>> '{scenarioId}', ''),
        CASE WHEN query LIKE 'google-alerts-rss:%'
          THEN NULLIF(substr(query, length('google-alerts-rss:') + 1), '')
        END
      ) IS NOT NULL
      THEN 'google-alerts-rss:' || "organizationId" || ':' || COALESCE(
        NULLIF(settings #>> '{scenarioId}', ''),
        CASE WHEN query LIKE 'google-alerts-rss:%'
          THEN NULLIF(substr(query, length('google-alerts-rss:') + 1), '')
        END
      )
    END,
    NULL,
    NULL,
    settings #>> '{googleAlertsRss,encryptedFeedUrl}'
  FROM public.monitoring_sources
  WHERE settings #>> '{googleAlertsRss,encryptedFeedUrl}' LIKE 'v1:%'

  UNION ALL
  SELECT
    'channel-search-index',
    'social-search-index:' || "organizationId",
    NULL,
    NULL,
    "apiKey"
  FROM public.channel_configs
  WHERE "channelType" = 'social_monitoring' AND "apiKey" LIKE 'v1:%'

  UNION ALL
  SELECT
    'social-account:' || COALESCE(NULLIF(platform, ''), '__missing_platform__'),
    CASE
      WHEN NULLIF(platform, '') IS NOT NULL AND NULLIF(handle, '') IS NOT NULL
      THEN 'oauth:' || platform || ':' || handle
    END,
    CASE platform
      WHEN 'youtube' THEN 'oauth:youtube'
      WHEN 'tiktok' THEN 'oauth:tiktok'
      WHEN 'tiktok-business' THEN 'oauth:tiktok-business'
      WHEN 'twitter' THEN 'oauth:twitter'
      WHEN 'telegram' THEN 'oauth:telegram'
    END,
    NULL,
    "accessToken"
  FROM public.social_accounts
  WHERE "accessToken" LIKE 'v1:%'
), token_candidates AS (
  SELECT *, row_number() OVER (PARTITION BY token_class ORDER BY ciphertext) AS sample_rank
  FROM raw_token_candidates
)
SELECT json_build_array(
         token_class, purpose_one, purpose_two, purpose_three, ciphertext
       )::text
  FROM token_candidates
 WHERE sample_rank <= 50
 ORDER BY token_class, sample_rank;
`

const tokenCandidatesQuery = spawnSync(
  "psql",
  ["-X", "-v", "ON_ERROR_STOP=1", "-At", "-c", tokenCandidatesSql],
  {
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: "-c app.rls_bypass=on" },
    maxBuffer: 4 * 1024 * 1024,
  },
)
if (tokenCandidatesQuery.status !== 0) {
  throw new Error("cannot read bounded integration-token recovery candidates")
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/")
  return Buffer.from(normalized + "=".repeat((4 - (normalized.length % 4)) % 4), "base64")
}

function decryptIntegrationToken(purpose, stored) {
  if (!stored.startsWith("v1:")) return undefined
  const base = createHash("sha256").update(nextAuthSecret).digest()
  const key = createHmac("sha256", base)
    .update(Buffer.from(`leaddrive:${purpose}`, "utf8"))
    .digest()
    .subarray(0, 32)
  const wire = decodeBase64Url(stored.slice(3))
  if (wire.length < 29) return undefined
  const decipher = createDecipheriv("aes-256-gcm", key, wire.subarray(0, 12))
  decipher.setAuthTag(wire.subarray(wire.length - 16))
  return Buffer.concat([
    decipher.update(wire.subarray(12, wire.length - 16)),
    decipher.final(),
  ]).toString("utf8")
}

const candidateClasses = new Map()
for (const line of tokenCandidatesQuery.stdout.split("\n")) {
  if (!line) continue
  let fields
  try {
    fields = JSON.parse(line)
  } catch {
    throw new Error("integration-token candidate query returned malformed data")
  }
  if (
    !Array.isArray(fields)
    || fields.length !== 5
    || typeof fields[0] !== "string"
    || !fields.slice(1, 4).every((value) => value === null || typeof value === "string")
    || typeof fields[4] !== "string"
    || !fields[4].startsWith("v1:")
  ) {
    throw new Error("integration-token candidate violated its recovery contract")
  }
  const [tokenClass, ...candidate] = fields
  if (!tokenInventory.has(tokenClass)) {
    throw new Error("integration-token candidate was absent from the inventory")
  }
  const candidates = candidateClasses.get(tokenClass) ?? []
  candidates.push(candidate)
  candidateClasses.set(tokenClass, candidates)
}

let integrationClassesPassed = 0
for (const [tokenClass] of tokenInventory) {
  const candidates = candidateClasses.get(tokenClass) ?? []
  let classPassed = false
  for (const [purposeOne, purposeTwo, purposeThree, ciphertext] of candidates) {
    const purposes = Array.from(new Set(
      [purposeOne, purposeTwo, purposeThree].filter(
        (purpose) => typeof purpose === "string" && purpose.length > 0,
      ),
    ))
    for (const purpose of purposes) {
      try {
        const plaintext = decryptIntegrationToken(purpose, ciphertext)
        if (typeof plaintext === "string" && plaintext.length > 0 && plaintext !== ciphertext) {
          classPassed = true
          break
        }
      } catch {
        // Try the next documented purpose/candidate without emitting secrets,
        // tenant identifiers, handles, source IDs, or authentication errors.
      }
    }
    if (classPassed) break
  }
  if (!classPassed) {
    throw new Error("restored NEXTAUTH_SECRET could not authenticate every persisted integration-token class")
  }
  integrationClassesPassed += 1
}

if (integrationClassesPassed > 0) {
  process.stdout.write(`[pii-restore-proof] encrypted integration token decrypt passed (${integrationClassesPassed} persisted classes; values redacted)\n`)
  process.stdout.write("[pii-restore-proof] INTEGRATION_TOKEN_DECRYPT_STATUS=passed\n")
} else {
  process.stdout.write("[pii-restore-proof] integration token decrypt not applicable (no persisted ciphertext present)\n")
  process.stdout.write("[pii-restore-proof] INTEGRATION_TOKEN_DECRYPT_STATUS=not_applicable_no_persisted_ciphertext\n")
}
