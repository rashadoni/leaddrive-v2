import { randomBytes } from "node:crypto"
import { lstat, open, readdir, readFile, rename, unlink } from "node:fs/promises"
import path from "node:path"
import {
  decodeTenantFileBytes,
  isTenantFileEnvelope,
  sealTenantFile,
  tenantFileKeyId,
  TENANT_FILE_MAX_HEADER_BYTES,
} from "@/lib/crypto/tenant-file-encryption"
import { ensureTenantDataKeys } from "@/lib/crypto/tenant-data-keys"
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

/**
 * Load the organization's data key so the envelope is written under it
 * ("d<N>"). When it cannot be loaded the file is still sealed, under the
 * derived key ("t1"), and the data key sweep picks it up later.
 */
async function loadDataKey(organizationId: string): Promise<boolean> {
  try {
    await ensureTenantDataKeys(organizationId)
    return true
  } catch {
    return false
  }
}

async function replaceWithEnvelope(filePath: string, organizationId: string, plain: Buffer): Promise<Buffer> {
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
  return sealed
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
        await loadDataKey(candidate.organizationId)
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

export type TenantFileRekeyCounts = {
  scanned: number
  /** Envelopes rewritten from "t1" to the organization's data key. */
  rekeyed: number
  /** Envelopes already under a data key. */
  onDataKey: number
  /** Plain files: the sealing backfill's job, not this one. */
  plain: number
  ownerUnknown: number
  keyUnavailable: number
  failed: number
}

export type TenantFileRekeyReport = {
  dryRun: boolean
  hasMore: boolean
  totals: TenantFileRekeyCounts
  /** "t1" envelopes left after this run, per organization. */
  derivedKeyFilesByOrganization: Record<string, number>
}

async function readHead(filePath: string): Promise<Buffer> {
  const handle = await open(filePath, "r")
  try {
    const head = Buffer.alloc(TENANT_FILE_MAX_HEADER_BYTES)
    const { bytesRead } = await handle.read(head, 0, head.byteLength, 0)
    return head.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * Re-seals up to `limit` envelopes written under the derived key ("t1") with
 * the organization's stored data key ("d<N>"), with the same atomic,
 * verified replacement as the sealing backfill. `dryRun` only counts, reading
 * file headers. The report carries counts only — per organization, no names
 * or paths.
 */
export async function rekeyTenantFiles(
  locations: readonly TenantFileLocation[],
  options: { limit: number; dryRun: boolean },
): Promise<TenantFileRekeyReport> {
  const totals: TenantFileRekeyCounts = {
    scanned: 0, rekeyed: 0, onDataKey: 0, plain: 0, ownerUnknown: 0, keyUnavailable: 0, failed: 0,
  }
  const remaining: Record<string, number> = {}
  const leave = (organizationId: string) => { remaining[organizationId] = (remaining[organizationId] ?? 0) + 1 }
  let hasMore = false
  let budget = options.limit
  for (const location of locations) {
    for (const candidate of await location.list()) {
      totals.scanned += 1
      let keyId: string | null
      try {
        const head = await readHead(candidate.path)
        if (!isTenantFileEnvelope(head)) {
          totals.plain += 1
          continue
        }
        keyId = tenantFileKeyId(head)
      } catch {
        totals.failed += 1
        continue
      }
      if (keyId !== "t1") {
        if (keyId) totals.onDataKey += 1
        else totals.failed += 1
        continue
      }
      if (!candidate.organizationId) {
        totals.ownerUnknown += 1
        continue
      }
      if (options.dryRun || budget <= 0) {
        if (!options.dryRun) hasMore = true
        leave(candidate.organizationId)
        continue
      }
      budget -= 1
      if (!(await loadDataKey(candidate.organizationId))) {
        totals.keyUnavailable += 1
        leave(candidate.organizationId)
        continue
      }
      try {
        const plain = decodeTenantFileBytes(candidate.organizationId, await readFile(candidate.path))
        const sealed = await replaceWithEnvelope(candidate.path, candidate.organizationId, plain)
        if (tenantFileKeyId(sealed) === "t1") throw new Error("data key not used")
        totals.rekeyed += 1
      } catch {
        totals.failed += 1
        leave(candidate.organizationId)
      }
    }
  }
  return { dryRun: options.dryRun, hasMore, totals, derivedKeyFilesByOrganization: remaining }
}
