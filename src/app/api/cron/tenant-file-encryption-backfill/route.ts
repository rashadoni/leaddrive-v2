/**
 * Seals customer files uploaded before encryption at rest
 * (`src/lib/crypto/tenant-file-backfill.ts`).
 *
 *   cron-trigger.sh "/api/cron/tenant-file-encryption-backfill"                    → dry run, counts only
 *   cron-trigger.sh "/api/cron/tenant-file-encryption-backfill?apply=1&limit=2000" → seals up to 2000 files
 *
 * A dry run is the default: writing needs `apply=1`, and it is meant to run
 * after a fresh runtime-files backup. Each call seals at most `limit` files;
 * repeat while `hasMore` is true. Already sealed files are skipped, so
 * repeating or interrupting a run is safe.
 *
 * The tenant of every file comes from the same place its reader takes it:
 * the `<orgId>` directory for path-encoded uploads, the owning row for bare
 * stored names. Files without an owning row are counted, never touched.
 * Thumbnails run after photos, so a sealed cache entry stays newer than its
 * sealed original.
 *
 * The response carries counts only — no names, paths or tenants.
 */
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/lib/cron-auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { isTenantPiiMasterKeyConfigured } from "@/lib/crypto/tenant-pii-encryption"
import {
  ownedFileLocation,
  pathEncodedLocation,
  sealLegacyTenantFiles,
  type TenantFileLocation,
} from "@/lib/crypto/tenant-file-backfill"
import { runtimePrivateUploadDirectory, runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { mobileDocumentStorageRoot } from "@/lib/mtm/mobile-document"
import { MTM_PHOTO_THUMBNAIL_DIR } from "@/lib/mtm/photo-thumbnail-server"

const DEFAULT_LIMIT = 500
const HARD_CAP = 5000

// Customer files only. Logos, email images and social logos are public by
// design and stay plain (see tenant-file-readers-guard.test.ts).
const PATH_ENCODED_SUBDIRS = ["inbox", "web-chat", "whatsapp", "telegram", "contract-images", "avatars", "mtm-invoices"] as const

function ownersBy<T extends { organizationId: string }>(key: (row: T) => string) {
  return (rows: T[]) => new Map(rows.map((row) => [key(row), row.organizationId]))
}

function locations(): TenantFileLocation[] {
  const photoUrl = (name: string) => `/uploads/mtm-photos/${name}`
  const photoOwners = async (names: string[]) => {
    const rows = await prisma.mtmPhoto.findMany({
      where: { url: { in: names.map(photoUrl) } },
      select: { url: true, organizationId: true },
    })
    return new Map(rows.map((row) => [row.url.slice(photoUrl("").length), row.organizationId]))
  }
  const photosDirectory = runtimePublicUploadDirectory("mtm-photos")

  return [
    ...PATH_ENCODED_SUBDIRS.map((subdir) => pathEncodedLocation(subdir, runtimePublicUploadDirectory(subdir))),
    ownedFileLocation("mtm-photos", photosDirectory, photoOwners),
    // `.thumbs/<photo file>.w<width>.webp` belongs to its photo's tenant.
    ownedFileLocation(
      "mtm-photo-thumbnails",
      path.join(photosDirectory, MTM_PHOTO_THUMBNAIL_DIR),
      photoOwners,
      (fileName) => /^(.+)\.w\d+\.webp$/.exec(fileName)?.[1] ?? null,
    ),
    ownedFileLocation("contracts", runtimePublicUploadDirectory("contracts"), async (names) =>
      ownersBy<{ fileName: string; organizationId: string }>((row) => row.fileName)(
        await prisma.contractFile.findMany({ where: { fileName: { in: names } }, select: { fileName: true, organizationId: true } }),
      )),
    ownedFileLocation("tasks", runtimePublicUploadDirectory("tasks"), async (names) =>
      ownersBy<{ fileName: string; organizationId: string }>((row) => row.fileName)(
        await prisma.taskAttachment.findMany({ where: { fileName: { in: names } }, select: { fileName: true, organizationId: true } }),
      )),
    ownedFileLocation("tickets", runtimePublicUploadDirectory("tickets"), async (names) =>
      ownersBy<{ fileName: string; organizationId: string }>((row) => row.fileName)(
        await prisma.ticketAttachment.findMany({ where: { fileName: { in: names } }, select: { fileName: true, organizationId: true } }),
      )),
    ownedFileLocation("mtm-documents", mobileDocumentStorageRoot(), async (names) =>
      ownersBy<{ storageKey: string; organizationId: string }>((row) => row.storageKey)(
        await prisma.mtmDocument.findMany({ where: { storageKey: { in: names } }, select: { storageKey: true, organizationId: true } }),
      )),
    ownedFileLocation("mtm-attendance", runtimePrivateUploadDirectory("mtm-attendance"), async (names) =>
      ownersBy<{ storageKey: string; organizationId: string }>((row) => row.storageKey)(
        await prisma.mtmAttendanceAttachment.findMany({ where: { storageKey: { in: names } }, select: { storageKey: true, organizationId: true } }),
      )),
  ]
}

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? Math.min(value, HARD_CAP) : DEFAULT_LIMIT
}

export async function POST(req: NextRequest) {
  // Owner lookups span every tenant; the bypass scope covers the whole run,
  // including each location's lazy `list()`.
  return runWithRlsBypass(async () => {
  const cronError = requireCronAuth(req)
  if (cronError) return cronError

  if (!isTenantPiiMasterKeyConfigured()) {
    return NextResponse.json({ error: "TENANT_PII_MASTER_KEY is not configured" }, { status: 500 })
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get("apply") !== "1"
  const limit = parseLimit(url.searchParams.get("limit"))

  try {
    const report = await sealLegacyTenantFiles(locations(), { limit, dryRun })
    return NextResponse.json({ success: true, data: { ...report, limit } })
  } catch (error) {
    console.error("[cron/tenant-file-encryption-backfill] error:", error instanceof Error ? error.message : "unknown")
    return NextResponse.json({ error: "Backfill run failed" }, { status: 500 })
  }
  })
}
