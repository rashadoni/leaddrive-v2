import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

/**
 * Atomically add/remove a feature flag on `Organization.features` (a jsonb array) WITHOUT a
 * read-modify-write. A plain `findUnique → splice → update` is a TOCTOU: two concurrent
 * settings saves (e.g. two tabs flipping different flags) both read the same array, and the
 * second write clobbers the first — silently dropping a flag. Here a single conditional
 * UPDATE does it in the database:
 *   • add    → `features || ["flag"]` guarded by `NOT (features @> ["flag"])` (idempotent);
 *   • remove → `features - 'flag'` (jsonb minus a text removes all matching array elements).
 * Both are serialized by Postgres row-locking, so no concurrent save can lose a flag.
 *
 * features is jsonb, but older writers stored the list as a jsonb STRING holding JSON text
 * (`JSON.stringify(array)` into a Json column). `string || array` in Postgres does not merge:
 * it makes `[ "<whole old list as text>", "flag" ]`, and every module in the old list is gone.
 * That took Zeytun's phone orders, MTM and VoIP down on 2026-11-26 when «Ağıllı axtarış» was
 * switched on. So every statement here first reads the column through FEATURES_ARRAY, which
 * turns such a string back into the array it holds.
 */
const FEATURES_ARRAY = Prisma.sql`(CASE WHEN jsonb_typeof(features) = 'string' THEN (features #>> '{}')::jsonb WHEN jsonb_typeof(features) = 'array' THEN features ELSE '[]'::jsonb END)`

export async function setOrgFeatureFlag(orgId: string, flag: string, enabled: boolean): Promise<void> {
  if (enabled) {
    await prisma.$executeRaw`
      UPDATE organizations
      SET features = ${FEATURES_ARRAY} || to_jsonb(ARRAY[${flag}]::text[])
      WHERE id = ${orgId} AND NOT (${FEATURES_ARRAY} @> to_jsonb(ARRAY[${flag}]::text[]))`
  } else {
    await prisma.$executeRaw`
      UPDATE organizations
      SET features = ${FEATURES_ARRAY} - ${flag}
      WHERE id = ${orgId}`
  }
}

/**
 * Replace every value-carrying flag under `prefixes` with `additions`, in ONE
 * statement, for the same reason `setOrgFeatureFlag` exists: a read-modify-write
 * of this array loses whatever another request wrote in between, and this array
 * is also where module entitlements live, so the flag that disappears can be a
 * paid surface.
 *
 * Returns the Prisma promise rather than awaiting it, so callers can put it in
 * the same transaction as the rest of their save.
 */
export function replaceOrgValueFlags(orgId: string, prefixes: string[], additions: string[]) {
  const patterns = prefixes.map((prefix) => `${prefix}%`)
  return prisma.$executeRaw`
    UPDATE organizations
    SET features = (
      SELECT COALESCE(jsonb_agg(f.value), '[]'::jsonb)
      FROM jsonb_array_elements(${FEATURES_ARRAY}) AS f(value)
      WHERE jsonb_typeof(f.value) <> 'string'
         OR NOT (f.value #>> '{}' LIKE ANY(${patterns}::text[]))
    ) || to_jsonb(${additions}::text[])
    WHERE id = ${orgId}`
}
