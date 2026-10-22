/**
 * Sealing legacy uploads on a real directory tree: every customer file ends
 * up an envelope that opens to its exact original bytes under the tenant its
 * reader uses; nothing without a known owner is touched; a dry run writes
 * nothing; repeating a run changes nothing.
 */
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  decodeTenantFileBytes,
  isTenantFileEnvelope,
  sealTenantFile,
} from "@/lib/crypto/tenant-file-encryption"
import {
  ownedFileLocation,
  pathEncodedLocation,
  sealLegacyTenantFiles,
} from "@/lib/crypto/tenant-file-backfill"

const ORG_A = "cmorgaaaaaaaaaaaaaaaaaaaa"
const ORG_B = "cmorgbbbbbbbbbbbbbbbbbbbb"

let root: string
const original = new Map<string, Buffer>()

async function put(relative: string, bytes: Buffer = randomBytes(70_000)) {
  const full = path.join(root, relative)
  await mkdir(path.dirname(full), { recursive: true })
  await writeFile(full, bytes)
  original.set(relative, bytes)
  return full
}

const stored = (relative: string) => readFile(path.join(root, relative))

function tree() {
  const owners = new Map([["photo-a.jpg", ORG_A], ["photo-b.jpg", ORG_B]])
  const photos = path.join(root, "mtm-photos")
  const resolve = async (names: string[]) => new Map(names.flatMap((name) => owners.has(name) ? [[name, owners.get(name) as string] as const] : []))
  return [
    pathEncodedLocation("inbox", path.join(root, "inbox")),
    ownedFileLocation("mtm-photos", photos, resolve),
    ownedFileLocation("mtm-photo-thumbnails", path.join(photos, ".thumbs"), resolve, (name) => /^(.+)\.w\d+\.webp$/.exec(name)?.[1] ?? null),
  ]
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "tenant-file-backfill-"))
  original.clear()
  await put(`inbox/${ORG_A}/a1.pdf`)
  await put(`inbox/${ORG_B}/b1.mp4`)
  await put(`inbox/${ORG_B}/empty.txt`, Buffer.alloc(0))
  await put("mtm-photos/photo-a.jpg")
  await put("mtm-photos/photo-b.jpg")
  await put("mtm-photos/orphan.jpg")
  await put("mtm-photos/.thumbs/photo-a.jpg.w480.webp", randomBytes(3000))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("sealLegacyTenantFiles", () => {
  it("dry run counts what it would seal and writes nothing", async () => {
    const report = await sealLegacyTenantFiles(tree(), { limit: 100, dryRun: true })

    expect(report.totals).toMatchObject({ scanned: 7, wouldSeal: 6, ownerUnknown: 1, sealed: 0, failed: 0 })
    for (const [relative, bytes] of original) expect((await stored(relative)).equals(bytes)).toBe(true)
  })

  it("seals each file for the tenant its reader uses, byte-exact, and leaves the orphan alone", async () => {
    await chmod(path.join(root, `inbox/${ORG_A}/a1.pdf`), 0o640)
    const report = await sealLegacyTenantFiles(tree(), { limit: 100, dryRun: false })

    expect(report.totals).toMatchObject({ scanned: 7, sealed: 6, ownerUnknown: 1, failed: 0 })
    expect(report.hasMore).toBe(false)
    const expectations: Array<[string, string]> = [
      [`inbox/${ORG_A}/a1.pdf`, ORG_A],
      [`inbox/${ORG_B}/b1.mp4`, ORG_B],
      [`inbox/${ORG_B}/empty.txt`, ORG_B],
      ["mtm-photos/photo-a.jpg", ORG_A],
      ["mtm-photos/photo-b.jpg", ORG_B],
      ["mtm-photos/.thumbs/photo-a.jpg.w480.webp", ORG_A],
    ]
    for (const [relative, tenant] of expectations) {
      const bytes = await stored(relative)
      expect(isTenantFileEnvelope(bytes), relative).toBe(true)
      expect(decodeTenantFileBytes(tenant, bytes).equals(original.get(relative) as Buffer), relative).toBe(true)
      const other = tenant === ORG_A ? ORG_B : ORG_A
      expect(() => decodeTenantFileBytes(other, bytes), relative).toThrow()
    }
    expect((await stored("mtm-photos/orphan.jpg")).equals(original.get("mtm-photos/orphan.jpg") as Buffer)).toBe(true)
    expect((await stat(path.join(root, `inbox/${ORG_A}/a1.pdf`))).mode & 0o777).toBe(0o640)
    // No temporary file is left beside any original.
    for (const directory of [`inbox/${ORG_A}`, `inbox/${ORG_B}`, "mtm-photos", "mtm-photos/.thumbs"]) {
      expect((await readdir(path.join(root, directory))).filter((name) => name.endsWith(".sealing"))).toEqual([])
    }
  })

  it("keeps a sealed thumbnail at least as new as its sealed photo", async () => {
    await sealLegacyTenantFiles(tree(), { limit: 100, dryRun: false })
    const photo = await stat(path.join(root, "mtm-photos/photo-a.jpg"))
    const thumb = await stat(path.join(root, "mtm-photos/.thumbs/photo-a.jpg.w480.webp"))
    expect(thumb.mtimeMs).toBeGreaterThanOrEqual(photo.mtimeMs)
  })

  it("stops at the limit, reports more work, and finishes on the next run", async () => {
    const first = await sealLegacyTenantFiles(tree(), { limit: 2, dryRun: false })
    expect(first.totals.sealed).toBe(2)
    expect(first.hasMore).toBe(true)

    const second = await sealLegacyTenantFiles(tree(), { limit: 100, dryRun: false })
    expect(second.totals).toMatchObject({ sealed: 4, alreadySealed: 2 })
    expect(second.hasMore).toBe(false)
  })

  it("is a no-op on a second full run and never re-seals an envelope", async () => {
    await put(`inbox/${ORG_A}/new.pdf`, sealTenantFile(ORG_A, Buffer.from("written after the switch")))
    await sealLegacyTenantFiles(tree(), { limit: 100, dryRun: false })
    const before = await stored(`inbox/${ORG_A}/a1.pdf`)

    const again = await sealLegacyTenantFiles(tree(), { limit: 100, dryRun: false })

    expect(again.totals).toMatchObject({ sealed: 0, alreadySealed: 7, ownerUnknown: 1 })
    expect((await stored(`inbox/${ORG_A}/a1.pdf`)).equals(before)).toBe(true)
    expect(decodeTenantFileBytes(ORG_A, await stored(`inbox/${ORG_A}/new.pdf`)).toString()).toBe("written after the switch")
  })

  it("ignores directories that are not tenant ids and missing locations", async () => {
    await put("inbox/../escape.txt")
    await put("inbox/Not A Tenant/x.txt")
    const report = await sealLegacyTenantFiles(
      [pathEncodedLocation("inbox", path.join(root, "inbox")), pathEncodedLocation("absent", path.join(root, "absent"))],
      { limit: 100, dryRun: true },
    )
    expect(report.locations.inbox.scanned).toBe(3)
    expect(report.locations.absent.scanned).toBe(0)
  })
})
