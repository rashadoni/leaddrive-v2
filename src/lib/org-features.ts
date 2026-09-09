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
 * features is jsonb (verified on prod) → the `||` / `-` / `@>` operators apply directly.
 */
export async function setOrgFeatureFlag(orgId: string, flag: string, enabled: boolean): Promise<void> {
  if (enabled) {
    await prisma.$executeRaw`
      UPDATE organizations
      SET features = features || to_jsonb(ARRAY[${flag}]::text[])
      WHERE id = ${orgId} AND NOT (features @> to_jsonb(ARRAY[${flag}]::text[]))`
  } else {
    await prisma.$executeRaw`
      UPDATE organizations
      SET features = features - ${flag}
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
      FROM jsonb_array_elements(features) AS f(value)
      WHERE jsonb_typeof(f.value) <> 'string'
         OR NOT (f.value #>> '{}' LIKE ANY(${patterns}::text[]))
    ) || to_jsonb(${additions}::text[])
    WHERE id = ${orgId}`
}
