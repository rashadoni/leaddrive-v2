import { randomBytes } from "node:crypto"
import { lstat, open, readdir, readFile, rename, unlink } from "node:fs/promises"
import path from "node:path"
import {
  decodeTenantFileBytes,
  isTenantFileEnvelope,
  sealTenantFile,
} from "@/lib/crypto/tenant-file-encryption"
import { isSafeOrganizationPathSegment } from "@/lib/upload-path-policy"

/**
 * Seals customer files that were written before uploads were encrypted
 * (`tenant-file-encryption.ts`). Every location names the tenant of each file
 * the same way its reader does, so a sealed file opens exactly where the plain
 * one was served:
 *
 *   • path-encoded directories: `<root>/<subdir>/<orgId>/<file>`;
 *   • owned directories: a database row maps the stored name to its tenant.
 *
 * A file whose tenant is unknown (no row) is counted and left untouched.
 * Each file is replaced atomically: the envelope is written beside it, synced,
 * proven to decode back to the exact original bytes, and only then renamed
 * over the original. Already sealed files are skipped, so a run can be
 * repeated or interrupted at any point.
 */

const TEMP_SUFFIX = ".sealing"

export type TenantFileCandidate = { path: string; organizationId: string | null }

export type TenantFileLocation = {
  /** Stable name in the report, e.g. "inbox" or "mtm-documents". */
  label: string
  list(): Promise<TenantFileCandidate[]>
}

export type TenantFileBackfillCounts = {
  scanned: number
  alreadySealed: number
  sealed: number
  wouldSeal: number
  ownerUnknown: number
  failed: number
}

export type TenantFileBackfillReport = {
  dryRun: boolean
  hasMore: boolean
  totals: TenantFileBackfillCounts
  locations: Record<string, TenantFileBackfillCounts>
}

function emptyCounts(): TenantFileBackfillCounts {
  return { scanned: 0, alreadySealed: 0, sealed: 0, wouldSeal: 0, ownerUnknown: 0, failed: 0 }
}

async function regularFiles(directory: string): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    return []
  }
  const files: string[] = []
  for (const name of names.sort()) {
    if (name.startsWith(".") || name.endsWith(TEMP_SUFFIX)) continue
    const full = path.join(directory, name)
    const info = await lstat(full).catch(() => null)
    if (info?.isFile()) files.push(full)
  }
  return files
}

/** `<directory>/<orgId>/<file>`: the tenant is the directory, as the proxy checks it. */
export function pathEncodedLocation(label: string, directory: string): TenantFileLocation {
  return {
    label,
    async list() {
      let tenants: string[]
      try {
        tenants = await readdir(directory)
      } catch {
        return []
      }
      const candidates: TenantFileCandidate[] = []
      for (const tenant of tenants.sort()) {
        if (!isSafeOrganizationPathSegment(tenant)) continue
        const tenantDirectory = path.join(directory, tenant)
        const info = await lstat(tenantDirectory).catch(() => null)
        if (!info?.isDirectory()) continue
        for (const file of await regularFiles(tenantDirectory)) candidates.push({ path: file, organizationId: tenant })
      }
      return candidates
    },
  }
}

/**
 * `<directory>/<stored name>`: `owners` resolves stored names to tenants from
 * the rows that reference them. `ownerName` maps a file name to the name the
 * rows know (thumbnails are named after their photo).
 */
export function ownedFileLocation(
  label: string,
  directory: string,
  owners: (names: string[]) => Promise<Map<string, string>>,
  ownerName: (fileName: string) => string | null = (fileName) => fileName,
): TenantFileLocation {
  return {
    label,
    async list() {
      const files = await regularFiles(directory)
      const keys = files.map((file) => ownerName(path.basename(file)))
      const lookup = [...new Set(keys.filter((key): key is string => key !== null))]
      const owned = new Map<string, string>()
      for (let start = 0; start < lookup.length; start += 500) {
        for (const [name, organizationId] of await owners(lookup.slice(start, start + 500))) {
          owned.set(name, organizationId)
        }
      }
      return files.map((file, index) => ({
        path: file,
        organizationId: keys[index] === null ? null : owned.get(keys[index] as string) ?? null,
      }))
    },
  }
}

async function replaceWithEnvelope(filePath: string, organizationId: string, plain: Buffer): Promise<void> {
  const sealed = sealTenantFile(organizationId, plain)
  // Never replace a file with something that does not open back to it.
  if (!decodeTenantFileBytes(organizationId, sealed).equals(plain)) throw new Error("seal round-trip mismatch")
  const info = await lstat(filePath)
  const temp = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}${TEMP_SUFFIX}`
  const handle = await open(temp, "wx", info.mode & 0o777)
  try {
    await handle.writeFile(sealed)
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(temp).catch(() => undefined)
    throw error
  }
  await handle.close()
  try {
    await rename(temp, filePath)
  } catch (error) {
    await unlink(temp).catch(() => undefined)
    throw error
  }
}

/**
 * Seals up to `limit` plain files across `locations`, in order. `dryRun`
 * counts what would be sealed without writing. The report carries counts
 * only — no paths, names or tenants.
 */
export async function sealLegacyTenantFiles(
  locations: readonly TenantFileLocation[],
  options: { limit: number; dryRun: boolean },
): Promise<TenantFileBackfillReport> {
  const report: TenantFileBackfillReport = {
    dryRun: options.dryRun,
    hasMore: false,
    totals: emptyCounts(),
    locations: {},
  }
  let budget = options.limit
  for (const location of locations) {
    const counts = (report.locations[location.label] ??= emptyCounts())
    for (const candidate of await location.list()) {
      counts.scanned += 1
      let stored: Buffer
      try {
        stored = await readFile(candidate.path)
      } catch {
        counts.failed += 1
        continue
      }
      if (isTenantFileEnvelope(stored)) {
        counts.alreadySealed += 1
        continue
      }
      if (!candidate.organizationId) {
        counts.ownerUnknown += 1
        continue
      }
      if (budget <= 0) {
        report.hasMore = true
        continue
      }
      budget -= 1
      if (options.dryRun) {
        counts.wouldSeal += 1
        continue
      }
      try {
        await replaceWithEnvelope(candidate.path, candidate.organizationId, stored)
        counts.sealed += 1
      } catch {
        counts.failed += 1
      }
    }
  }
  for (const counts of Object.values(report.locations)) {
    for (const key of Object.keys(counts) as Array<keyof TenantFileBackfillCounts>) {
      report.totals[key] += counts[key]
    }
  }
  return report
}
