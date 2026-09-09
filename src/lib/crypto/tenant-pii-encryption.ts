/**
 * Phase 7 slice-2 P0 #1 — per-tenant PII column encryption.
 *
 * Wraps Node's `crypto` module to encrypt / decrypt sensitive
 * columns (PHI / PII / FOIA-able) at the application layer, with
 * per-tenant data-encryption keys (DEKs) derived from a project-
 * level master KEK.
 *
 * Trust model (slice-2 interim):
 *   • Master KEK: env var `TENANT_PII_MASTER_KEY` (32 bytes, hex).
 *     Set per environment via secret manager. NEVER committed.
 *   • Per-tenant DEK: HKDF-SHA256(KEK, salt=orgId, info=INFO_LABEL)
 *     → 32-byte key. Deterministic — same orgId always derives the
 *     same DEK from the same KEK. No DB storage in slice-2.
 *   • Encryption: AES-256-GCM with 12-byte IV (random per encrypt)
 *     + 16-byte auth tag. Cipher format: base64( IV(12) | ciphertext | tag(16) ).
 *   • Authenticated additional data (AAD): the orgId. This binds
 *     the ciphertext to its tenant — an attacker who copies a
 *     ciphertext from tenant A to tenant B's row will fail
 *     decryption (GCM tag mismatch). Defense-in-depth against
 *     cross-tenant ciphertext-shuffle attacks.
 *
 * Slice-3 vault swap (when D5 Phase 5 NamedCredentials vault ships
 * per `memory/project_payments_slice2_p0.md` item 2):
 *   • `loadMasterKek()` is the single choke point.
 *   • Replace the env-var read with `vault.fetch("tenant-pii-master")`.
 *   • No other callsite changes.
 *
 * Key rotation (slice-3):
 *   • Append new TenantMasterKey row with incrementing version.
 *   • Background sweep re-encrypts existing ciphertexts under new
 *     DEK; previous version row's supersededAt + supersededByVersion
 *     get set.
 *   • Ciphertext format will gain a version prefix in slice-3 so
 *     decrypt can pick the right DEK. Slice-2 ciphertexts implicitly
 *     use version=1.
 *
 * What this helper does NOT do (and why):
 *   • Postgres pgcrypto `pgp_sym_encrypt` is NOT used. We do AES-GCM
 *     in Node so the key never crosses the DB boundary (pgp_sym_encrypt
 *     takes the key as a function argument — visible in query logs).
 *   • No per-tenant DEK storage in slice-2 — derived deterministically.
 *     Storage adds rotation flexibility but isn't required until rotation
 *     is wired (slice-3).
 *   • No automatic encryption-on-Prisma-write — caller invokes
 *     encryptForTenant() / decryptForTenant() explicitly. Wiring a
 *     Prisma middleware is slice-2-mini route-layer work alongside
 *     R2/R7/R8 column-by-column rollout.
 */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "crypto"

/* ─── Constants ──────────────────────────────────────────────────── */

const ALGORITHM = "aes-256-gcm" as const
const IV_BYTES = 12 // GCM standard
const TAG_BYTES = 16 // GCM standard
const KEY_BYTES = 32 // AES-256
const KEK_HEX_BYTES = 64 // 32 bytes hex-encoded

/**
 * HKDF info label binds derived DEKs to this project + version. If
 * we ever need a key-domain-separation (e.g. different DEKs for
 * different table classes), append a sub-label to this constant.
 */
const INFO_LABEL = "leaddrive-tenant-pii-v1"

const ENV_VAR = "TENANT_PII_MASTER_KEY"

/* ─── Master KEK load (the slice-3 vault-swap choke point) ──────── */

let cachedMasterKek: Buffer | null = null

/**
 * Load the master KEK. Single choke point for the slice-3 swap
 * from env-var → NamedCredentials vault. Cached across calls
 * (KEK doesn't change within a process); use `resetMasterKekCache()`
 * in tests.
 *
 * Throws if `TENANT_PII_MASTER_KEY` is missing or malformed.
 */
function loadMasterKek(): Buffer {
  if (cachedMasterKek) return cachedMasterKek
  const raw = process.env[ENV_VAR]
  if (!raw) {
    throw new Error(
      `${ENV_VAR} is not set. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    )
  }
  if (raw.length !== KEK_HEX_BYTES) {
    throw new Error(
      `${ENV_VAR} must be exactly ${KEK_HEX_BYTES} hex chars (32 bytes). Got ${raw.length}.`,
    )
  }
  if (!/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(`${ENV_VAR} must be hex-encoded (got non-hex chars).`)
  }
  cachedMasterKek = Buffer.from(raw, "hex")
  return cachedMasterKek
}

/**
 * Test-only: clear the cached KEK so a fresh env var read happens.
 * Production code should never call this.
 */
export function resetMasterKekCache(): void {
  cachedMasterKek = null
}

/* ─── Per-tenant DEK derivation ──────────────────────────────────── */

/**
 * Derive a per-tenant DEK from the master KEK using HKDF-SHA256.
 * Deterministic — same orgId always produces the same key under
 * the same KEK. Caller doesn't need to cache.
 *
 * `orgId` is used as the HKDF salt. The salt MUST be unique-per-
 * tenant (orgId satisfies this — Organization.id is cuid-unique).
 * INFO binds the derivation to this project version (allows
 * future key-domain-separation by changing the constant).
 */
function deriveTenantDek(orgId: string): Buffer {
  if (typeof orgId !== "string" || orgId.length === 0) {
    throw new Error("deriveTenantDek: orgId required")
  }
  const kek = loadMasterKek()
  // hkdfSync(digest, ikm, salt, info, keylen) — Node 16+ API.
  // ikm = the master KEK; salt = orgId bytes; info = version-binding
  // string; output = 32-byte DEK.
  const dek = hkdfSync("sha256", kek, Buffer.from(orgId, "utf8"), INFO_LABEL, KEY_BYTES)
  return Buffer.from(dek)
}

/* ─── Encrypt / decrypt API ──────────────────────────────────────── */

/**
 * Encrypt a plaintext PII value for a specific tenant. Returns
 * base64-armored ciphertext with embedded IV + auth tag.
 *
 * The orgId is included as authenticated additional data (AAD), so
 * decrypt requires the SAME orgId — protects against cross-tenant
 * ciphertext shuffle (defense-in-depth on top of FK/coherence triggers).
 *
 * @throws on empty plaintext (caller bug — encrypt('') is meaningless;
 *         use null on the column instead).
 */
export function encryptForTenant(orgId: string, plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptForTenant: plaintext must be non-empty string")
  }
  const dek = deriveTenantDek(orgId)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, dek, iv)
  cipher.setAAD(Buffer.from(orgId, "utf8"))
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  if (tag.length !== TAG_BYTES) {
    // Defensive — Node should always give 16-byte GCM tag.
    throw new Error("encryptForTenant: unexpected GCM tag length")
  }
  // Wire format: IV (12) | ciphertext | tag (16), then base64.
  return Buffer.concat([iv, ciphertext, tag]).toString("base64")
}

/**
 * Decrypt a ciphertext previously produced by encryptForTenant()
 * for the SAME tenant. Returns the original plaintext.
 *
 * Throws on:
 *   • Malformed base64 / wrong length (corrupted ciphertext).
 *   • Cross-tenant attempt (orgId AAD mismatch fails the GCM tag check).
 *   • Wrong master KEK (DEK derivation produces wrong key → tag fails).
 *   • Tampered ciphertext bytes (GCM tag check fails).
 */
export function decryptForTenant(orgId: string, ciphertextB64: string): string {
  if (typeof ciphertextB64 !== "string" || ciphertextB64.length === 0) {
    throw new Error("decryptForTenant: ciphertext must be non-empty string")
  }
  const wire = Buffer.from(ciphertextB64, "base64")
  if (wire.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error(
      `decryptForTenant: ciphertext too short (got ${wire.length} bytes, min ${IV_BYTES + TAG_BYTES + 1})`,
    )
  }
  const iv = wire.subarray(0, IV_BYTES)
  const tag = wire.subarray(wire.length - TAG_BYTES)
  const ciphertext = wire.subarray(IV_BYTES, wire.length - TAG_BYTES)

  const dek = deriveTenantDek(orgId)
  const decipher = createDecipheriv(ALGORITHM, dek, iv)
  decipher.setAAD(Buffer.from(orgId, "utf8"))
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])
  return plaintext.toString("utf8")
}

/* ─── Ciphertext version prefix (slice-3 follow-up #4) ───────────── */

/**
 * Ciphertext version prefix scheme.
 *
 * Slice-2 ciphertexts (PR #89 + #118-#133) use the bare wire format
 * `IV(12) | ciphertext | tag(16)` base64-encoded. We call this v1.
 * They have NO version marker — readers assume v1.
 *
 * Future migrations (DEK rotation, AAD bind to (orgId, table, column),
 * algorithm upgrades) need a way to distinguish ciphertext format
 * versions on read so the right derivation/AAD pair is applied.
 *
 * Design: a 3-character base64-prefix `vN:` (e.g. `v2:`) precedes
 * the base64 payload for v2+ ciphertexts. v1 ciphertexts have NO
 * prefix and decode the same as before.
 *
 * Discriminator: a fully-valid base64 ciphertext NEVER starts with
 * the literal characters `vN:` (the `:` is not in the base64 alphabet).
 * So `value.startsWith("v")` AND `value[2] === ":"` is sufficient
 * to detect v2+.
 *
 * Migration plan:
 *   • Phase 1 (this PR): scheme + helpers shipped, NOT used yet.
 *   • Phase 2: DEK rotation cron uses v2 format with rotation
 *     metadata embedded; reads dispatch on prefix.
 *   • Phase 3: backfill re-encrypts v1 → v2 over time; legacy v1
 *     read path remains until migration completes.
 */
export const CIPHERTEXT_VERSION_V1 = 1
export const CIPHERTEXT_VERSION_V2 = 2

/**
 * Detect the version of a base64 ciphertext string. Returns 1 for
 * bare-base64 (legacy) and 2+ for prefix-decorated forms.
 */
export function ciphertextVersion(value: string): number {
  if (typeof value !== "string" || value.length < 3) {
    return CIPHERTEXT_VERSION_V1
  }
  if (value[0] === "v" && value[2] === ":") {
    const v = parseInt(value[1], 10)
    if (Number.isInteger(v) && v >= 2 && v <= 9) {
      return v
    }
  }
  return CIPHERTEXT_VERSION_V1
}

/**
 * Wrap a base64 payload with a version prefix. Currently only used
 * by tests + future migration paths. Routes continue to write v1
 * (no prefix) until slice-3 cuts over.
 *
 * ⚠️ FOOTGUN GUARD: `decryptForTenant` / `softDecryptForTenant` do
 * NOT yet call `stripCiphertextVersion` — if a `vN:…` value gets
 * written to a column today and read back, the decrypt would fail
 * (soft path returns the prefixed string as plaintext, which is
 * wrong). To prevent this in production code paths, the helper
 * accepts only the test-mode override; production callers must use
 * the post-Phase-2-cutover variants (not yet written).
 *
 * Pass `{ unsafeAllow: true }` from tests / scripts that own the
 * full read cycle and don't go through `decryptForTenant`.
 */
export function wrapCiphertextVersion(
  version: number,
  payloadB64: string,
  opts: { unsafeAllow?: boolean } = {},
): string {
  if (!Number.isInteger(version) || version < 2 || version > 9) {
    throw new Error(
      `wrapCiphertextVersion: version must be integer 2..9 (got ${version})`,
    )
  }
  if (typeof payloadB64 !== "string" || payloadB64.length === 0) {
    throw new Error("wrapCiphertextVersion: payload must be non-empty string")
  }
  if (!opts.unsafeAllow) {
    throw new Error(
      `wrapCiphertextVersion: v${version} write path has no matching reader yet. ` +
        `decryptForTenant + softDecryptForTenant do not strip the prefix as of this commit. ` +
        `Pass { unsafeAllow: true } only if you own the full encode/decode cycle ` +
        `(tests, scripts) and won't round-trip through the production decrypt paths. ` +
        `Production cutover lands in slice-3 when the read paths gain version dispatch.`,
    )
  }
  return `v${version}:${payloadB64}`
}

/**
 * Strip the version prefix and return the bare base64 payload. v1
 * inputs pass through unchanged.
 */
export function stripCiphertextVersion(value: string): string {
  const v = ciphertextVersion(value)
  if (v === CIPHERTEXT_VERSION_V1) return value
  return value.slice(3) // strip "vN:"
}

/* ─── Column-bound encryption (slice-3 follow-up #5) ─────────────── */

/**
 * AAD-strengthening variant of `encryptForTenant`. Binds the
 * ciphertext to a (tenant, table, column) tuple instead of tenant
 * only — same-tenant cross-column ciphertext-shuffle attacks (e.g.
 * copying `citizens.taxId` into `citizens.fullName`) fail the GCM
 * tag check.
 *
 * Architect's slice-3 follow-up #5 from the post-#134 sweep.
 *
 * AAD format: `${orgId}|${table}|${column}` (UTF-8 bytes).
 *   • `|` is the separator; values must not contain it (safe — table
 *     + column names are slugs from a closed enum, orgId is a cuid).
 *   • Order matters; `(citizens, fullName)` AAD ≠ `(fullName, citizens)`.
 *
 * Migration plan:
 *   • Phase 1 (this PR): helpers shipped but NOT yet wired into routes.
 *   • Phase 2: each route migrated to `encryptForTenantBound` /
 *     `softDecryptForTenantBound`. The soft variant falls back to
 *     `decryptForTenant` (orgId-only AAD) when bound decrypt fails,
 *     so legacy ciphertexts continue to read while the column wraps
 *     re-encrypt on next write.
 *   • Phase 3: backfill cron re-encrypts existing ciphertexts under
 *     bound AAD. Once 100% migrated per (table, column), the soft
 *     fallback is dropped.
 *
 * @throws on empty plaintext or empty table/column.
 */
export function encryptForTenantBound(
  orgId: string,
  table: string,
  column: string,
  plaintext: string,
): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error(
      "encryptForTenantBound: plaintext must be non-empty string",
    )
  }
  if (typeof table !== "string" || table.length === 0) {
    throw new Error("encryptForTenantBound: table must be non-empty string")
  }
  if (typeof column !== "string" || column.length === 0) {
    throw new Error("encryptForTenantBound: column must be non-empty string")
  }
  if (orgId.includes("|") || table.includes("|") || column.includes("|")) {
    // The `|` separator must not appear inside any component, else
    // attacker could craft (orgId="a|b", table="c", column="d") vs
    // (orgId="a", table="b|c", column="d") collision.
    throw new Error("encryptForTenantBound: AAD components must not contain '|'")
  }
  const dek = deriveTenantDek(orgId)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, dek, iv)
  cipher.setAAD(Buffer.from(`${orgId}|${table}|${column}`, "utf8"))
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, ciphertext, tag]).toString("base64")
}

/**
 * Decrypt a column-bound ciphertext produced by `encryptForTenantBound`.
 * Strict — throws on AAD mismatch (wrong table/column or wrong
 * tenant).
 */
export function decryptForTenantBound(
  orgId: string,
  table: string,
  column: string,
  ciphertextB64: string,
): string {
  if (typeof ciphertextB64 !== "string" || ciphertextB64.length === 0) {
    throw new Error(
      "decryptForTenantBound: ciphertext must be non-empty string",
    )
  }
  const wire = Buffer.from(ciphertextB64, "base64")
  if (wire.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error(
      `decryptForTenantBound: ciphertext too short (got ${wire.length} bytes)`,
    )
  }
  const iv = wire.subarray(0, IV_BYTES)
  const tag = wire.subarray(wire.length - TAG_BYTES)
  const ciphertext = wire.subarray(IV_BYTES, wire.length - TAG_BYTES)
  const dek = deriveTenantDek(orgId)
  const decipher = createDecipheriv(ALGORITHM, dek, iv)
  decipher.setAAD(Buffer.from(`${orgId}|${table}|${column}`, "utf8"))
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ])
  return plaintext.toString("utf8")
}

/**
 * Soft-decrypt variant for the bound-AAD migration. Tries the bound
 * AAD first; if that fails, falls back to legacy orgId-only AAD;
 * if THAT fails, returns the input as-is (legacy plaintext row).
 *
 * Used during the column-by-column migration window: routes wired
 * to `encryptForTenantBound` on writes can still read existing
 * ciphertexts that were produced under orgId-only AAD.
 */
export function softDecryptForTenantBound(
  orgId: string,
  table: string,
  column: string,
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined || value === "") {
    return null
  }
  if (
    !/^[A-Za-z0-9+/]+=*$/.test(value) ||
    Buffer.from(value, "base64").length < IV_BYTES + TAG_BYTES + 1
  ) {
    return value
  }
  // Try the new bound AAD first.
  try {
    return decryptForTenantBound(orgId, table, column, value)
  } catch {
    // Fall through to legacy orgId-only AAD.
  }
  try {
    return decryptForTenant(orgId, value)
  } catch {
    // Plaintext fallback (pre-encryption legacy row).
    return value
  }
}

/* ─── Convenience: nullable wrappers ─────────────────────────────── */

/**
 * Encrypt if value is non-empty, return null otherwise. Useful for
 * optional columns where null in the DB means "no value" and we
 * don't want to encrypt empty strings.
 */
export function encryptForTenantOrNull(
  orgId: string,
  plaintext: string | null | undefined,
): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") {
    return null
  }
  return encryptForTenant(orgId, plaintext)
}

/**
 * Decrypt if ciphertext is non-empty, return null otherwise.
 */
export function decryptForTenantOrNull(
  orgId: string,
  ciphertextB64: string | null | undefined,
): string | null {
  if (ciphertextB64 === null || ciphertextB64 === undefined || ciphertextB64 === "") {
    return null
  }
  return decryptForTenant(orgId, ciphertextB64)
}

/**
 * Column-bound nullable wrapper — slice-3 sibling to
 * `encryptForTenantOrNull`. Encrypt with AAD bound to
 * (orgId, table, column) when value is non-empty; return null
 * otherwise. Use this for optional PII columns on the slice-3 sweep
 * so write paths stay null-tolerant after migrating to the bound
 * variant. (Helper added 2026-05-29 to round out the API surface
 * shipped in PR #136; the missing nullable wrapper would force
 * call sites to handle null inline.)
 */
export function encryptForTenantBoundOrNull(
  orgId: string,
  table: string,
  column: string,
  plaintext: string | null | undefined,
): string | null {
  if (plaintext === null || plaintext === undefined || plaintext === "") {
    return null
  }
  return encryptForTenantBound(orgId, table, column, plaintext)
}

/**
 * Column-bound nullable wrapper — slice-3 sibling to
 * `decryptForTenantOrNull`. STRICT decrypt with AAD bound to
 * (orgId, table, column). Throws on any AAD mismatch (including
 * legacy orgId-only ciphertext). For the migration-tolerant path
 * use `softDecryptForTenantBound`.
 */
export function decryptForTenantBoundOrNull(
  orgId: string,
  table: string,
  column: string,
  ciphertextB64: string | null | undefined,
): string | null {
  if (ciphertextB64 === null || ciphertextB64 === undefined || ciphertextB64 === "") {
    return null
  }
  return decryptForTenantBound(orgId, table, column, ciphertextB64)
}

/**
 * Soft-decrypt: try to decrypt; if the value isn't valid ciphertext
 * (wrong format, GCM tag mismatch), return it as-is. This is the
 * column-by-column transitional rollout helper: column starts with
 * plaintext values; new writes encrypt; existing rows read back as
 * plaintext until backfilled.
 *
 * Use only at the route-layer read path. Once a column-backfill
 * migration has converted every row to ciphertext, drop callers back
 * to the strict `decryptForTenant` helper.
 *
 * Slice-3 plan: a `tenant_pii_backfill_progress` table tracks which
 * (table, column) pairs are fully ciphertext — once 100% covered, the
 * column-specific route paths flip from soft to strict.
 */
export function softDecryptForTenant(
  orgId: string,
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined || value === "") {
    return null
  }
  // Heuristic: valid ciphertext is base64 AND decodes to at least
  // IV+TAG+1 bytes (29+). Anything shorter must be plaintext.
  // The base64 regex is permissive — plaintext that happens to be
  // base64-shaped still gets through to the decrypt try/catch.
  if (
    !/^[A-Za-z0-9+/]+=*$/.test(value) ||
    Buffer.from(value, "base64").length < IV_BYTES + TAG_BYTES + 1
  ) {
    return value
  }
  try {
    return decryptForTenant(orgId, value)
  } catch {
    // Either malformed base64, wrong tenant, or plaintext that
    // happened to look like base64. Treat as plaintext fallback.
    return value
  }
}

/* ─── Blind index for substring/equality search on encrypted columns ─ */

/**
 * Domain-separated HMAC key for blind-index derivation. Distinct
 * from `INFO_LABEL` (which keys the encryption DEK) so that an
 * attacker who compromises one key class doesn't get the other.
 *
 * Bump to `-v2` if `normalizeForBlindIndex` changes: old hashes
 * computed under the previous normalization rules would no longer
 * collide with new queries, so the `<col>BlindIndex` column needs
 * a full backfill under the new key version. Pattern mirrors the
 * `INFO_LABEL` versioning at line 65.
 */
const BLIND_INDEX_INFO = "leaddrive-tenant-pii-blind-index-v1"

/**
 * Cached per-tenant HMAC keys.
 *
 * NOTE on cardinality: unbounded Map<orgId, 32-byte Buffer>. At our
 * current target (<1000 tenants/process) and ~120 B/entry overhead
 * on V8, worst case is ~120 KB — not worth an LRU dependency yet.
 * If tenant count crosses ~10k per process (e.g. a single CRM
 * instance serving thousands of small accounts), swap to a sized
 * lru-cache. Same caching posture as `cachedMasterKek` upstream.
 *
 * Reset semantics: callable via `resetBlindIndexKeyCache()` in tests
 * (the KEK reset cascades because derivation re-runs on next access).
 */
const blindIndexKeyCache = new Map<string, Buffer>()

function deriveTenantBlindIndexKey(orgId: string): Buffer {
  if (typeof orgId !== "string" || orgId.length === 0) {
    throw new Error("deriveTenantBlindIndexKey: orgId required")
  }
  const cached = blindIndexKeyCache.get(orgId)
  if (cached) return cached
  const kek = loadMasterKek()
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      kek,
      Buffer.from(orgId, "utf8"),
      BLIND_INDEX_INFO,
      KEY_BYTES,
    ),
  )
  blindIndexKeyCache.set(orgId, key)
  return key
}

/**
 * Normalize a plaintext value before hashing so callers querying with
 * any-case/extra-whitespace get the same hash as the stored row.
 *
 * Steps:
 *   1. NFKC unicode normalize (compose decomposed forms — `é` vs
 *      `e + ́` collide)
 *   2. lowercase (case-insensitive equality match)
 *   3. collapse internal whitespace to a single space
 *   4. trim leading/trailing whitespace
 *
 * Punctuation and accents are preserved — distinct names stay
 * distinct. "Jose" and "José" hash differently (intentional —
 * collapsing them would return wrong-person rows on decrypt), and
 * "J. Doe" stays separate from "J Doe". Do NOT add
 * `.replace(/[^\w\s]/g, "")` here; if a caller needs looser
 * matching they should fuzzy-match the decrypted plaintext after
 * the index narrows the candidate set.
 *
 * Exposed (rather than module-internal) so future n-gram tokenizer
 * callers can re-use the same normalization for substring search
 * tokens — distinct from this helper, which only supports equality.
 */
export function normalizeForBlindIndex(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()
}

/**
 * Compute a deterministic blind index over (orgId, normalized value).
 * Same plaintext under the same tenant → same hash. Cross-tenant
 * shuffle yields a different hash (orgId enters the HMAC key
 * derivation, not the message — so the HMAC over the same value is
 * provably distinct per tenant).
 *
 * Output: base64url-encoded SHA-256 HMAC (44 chars without padding).
 * Suitable for an indexed text column.
 *
 * Use case: column `<col>BlindIndex String?` indexed alongside the
 * encrypted `<col>` ciphertext. Writes compute both; equality search
 * queries the index instead of decrypting + scanning.
 *
 * Returns null on null/undefined input — mirrors the
 * `encryptForTenantOrNull` pattern so callers can chain.
 *
 * NOTE: This is an EQUALITY-search index, not a true substring index.
 * Substring search needs n-gram tokenization on top (slice-3+ work).
 * The architect-flagged gap was specifically equality + prefix search
 * on full names — equality is the immediate win.
 */
export function blindIndexForTenant(
  orgId: string,
  plaintext: string | null | undefined,
): string | null {
  if (plaintext === null || plaintext === undefined) return null
  if (typeof plaintext !== "string") {
    throw new Error("blindIndexForTenant: plaintext must be string or null")
  }
  const normalized = normalizeForBlindIndex(plaintext)
  if (normalized.length === 0) return null
  const key = deriveTenantBlindIndexKey(orgId)
  const mac = createHmac("sha256", key).update(normalized, "utf8").digest()
  // base64url to keep the index column ASCII-safe + URL-safe (rarely
  // matters but cheap). Strip = padding for compactness — 32-byte
  // SHA-256 → 43 chars base64url-no-padding.
  return mac.toString("base64url").replace(/=+$/, "")
}

/**
 * Test-only: clear the blind-index key cache. Production code should
 * never call this.
 */
export function resetBlindIndexKeyCache(): void {
  blindIndexKeyCache.clear()
}
