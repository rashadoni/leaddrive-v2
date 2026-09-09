-- Phase 7 slice-2 P0 #1 — PII encryption primitives.
--
-- Enables pgcrypto extension (used by the encryption helper for
-- random IV generation via gen_random_bytes; the AES-256-GCM encrypt
-- is done in Node's `crypto` module application-side, not via
-- pgp_sym_encrypt, because GCM auth-tag handling is cleaner in JS
-- and avoids the "key passes through the DB layer" footgun).
--
-- The actual per-column wrapping (R2/R7/R8/R11 PII columns enumerated
-- in `memory/project_phase7_slice2_inventory.md` item 1) lands when
-- those modules' slice-2-mini routes are built. This migration ships
-- the EXTENSION + the key-storage table; the helper module
-- `src/lib/crypto/tenant-pii-encryption.ts` ships the encrypt /
-- decrypt API.
--
-- Trust model (slice-2 interim):
--   • Master KEK lives in env var `TENANT_PII_MASTER_KEY` (32-byte
--     random, hex-encoded). Set per environment via secret manager.
--   • Per-tenant DEK derived deterministically: HKDF-SHA256(KEK,
--     salt=orgId, info="leaddrive-tenant-pii-v1") → 32-byte key.
--   • DEKs are NOT stored in the DB — derived on each encrypt /
--     decrypt call. Rotating the KEK rotates ALL tenant DEKs in one
--     deploy (re-encrypt sweep is a separate slice-3 op).
--   • Slice-3 swap path: when D5 Phase 5 NamedCredentials vault ships
--     (per `memory/project_payments_slice2_p0.md` item 2), the KEK
--     load path moves from env var → vault.fetch(`tenant-pii-master`).
--     Helper exposes a single `loadMasterKek()` choke-point for the
--     swap (see helper module).
--
-- `tenant_master_keys` table is reserved for slice-3 per-tenant key
-- versioning + rotation history. Empty in slice-2 (derived DEKs
-- don't need persistence). Schema stub ships now so the slice-3
-- migration is additive.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "tenant_master_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    /**
     * Key version. Slice-3 rotation appends a new row with
     * incrementing version + activatedAt; ciphertexts encrypted under
     * the old version are re-encrypted by a background sweep.
     */
    "version" INTEGER NOT NULL,
    /**
     * Wrapped DEK ciphertext, base64. Encrypted under the current
     * KEK using the same AES-256-GCM scheme as PII columns.
     * Empty in slice-2 (DEKs are derived, not stored). Reserved.
     */
    "wrappedDek" TEXT,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    /**
     * Set when this version is superseded by a newer version. NULL =
     * currently-active version.
     */
    "supersededAt" TIMESTAMP(3),
    "supersededByVersion" INTEGER,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_master_keys_pkey" PRIMARY KEY ("id")
);

-- Exactly one active version per tenant at a time. Active = supersededAt NULL.
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_master_keys_org_active_uniq"
  ON "tenant_master_keys"("organizationId")
  WHERE "supersededAt" IS NULL;

-- Lookup hot path: which version was active at a given point in time
-- (for ciphertext decryption against historical version).
CREATE INDEX IF NOT EXISTS "tenant_master_keys_org_version_idx"
  ON "tenant_master_keys"("organizationId", "version");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_master_keys_organizationId_fkey') THEN
    ALTER TABLE "tenant_master_keys"
      ADD CONSTRAINT "tenant_master_keys_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Append-only enforcement: rotation appends new rows + flips
-- `supersededAt` on the prior. Hard-delete + UPDATE of immutable
-- fields would corrupt the rotation timeline.
CREATE OR REPLACE FUNCTION tenant_master_keys_immutability_fn()
RETURNS TRIGGER AS $$
BEGIN
  -- Block DELETE entirely (key history is forensic evidence).
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tenant_master_keys rows are append-only — DELETE rejected (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  -- Allow UPDATE only on supersededAt + supersededByVersion (rotation).
  IF OLD."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'tenant_master_keys.organizationId is immutable (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."version" IS DISTINCT FROM NEW."version" THEN
    RAISE EXCEPTION 'tenant_master_keys.version is immutable (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."wrappedDek" IS DISTINCT FROM NEW."wrappedDek" THEN
    RAISE EXCEPTION 'tenant_master_keys.wrappedDek is immutable (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."activatedAt" IS DISTINCT FROM NEW."activatedAt" THEN
    RAISE EXCEPTION 'tenant_master_keys.activatedAt is immutable (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  -- supersededAt / supersededByVersion are SET-once (NULL → value).
  IF OLD."supersededAt" IS NOT NULL AND NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt" THEN
    RAISE EXCEPTION 'tenant_master_keys.supersededAt is immutable once set (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."supersededByVersion" IS NOT NULL AND NEW."supersededByVersion" IS DISTINCT FROM OLD."supersededByVersion" THEN
    RAISE EXCEPTION 'tenant_master_keys.supersededByVersion is immutable once set (id=%)',
      OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenant_master_keys_immutability_trigger ON "tenant_master_keys";
CREATE TRIGGER tenant_master_keys_immutability_trigger
  BEFORE UPDATE OR DELETE ON "tenant_master_keys"
  FOR EACH ROW
  EXECUTE FUNCTION tenant_master_keys_immutability_fn();
