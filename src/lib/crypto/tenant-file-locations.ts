/**
 * Where customer files live and which tenant each belongs to — shared by the
 * sealing backfill (`/api/cron/tenant-file-encryption-backfill`) and the data
 * key sweep (`/api/cron/tenant-data-key-reencrypt`).
 *
 * The tenant of every file comes from the same place its reader takes it:
 * the `<orgId>` directory for path-encoded uploads, the owning row for bare
 * stored names. Thumbnails come after photos, so a re-sealed cache entry stays
 * newer than its re-sealed original. Callers run under `runWithRlsBypass`:
 * the owner lookups span every tenant.
 */
import path from "node:path"
import { prisma } from "@/lib/prisma"
import {
  ownedFileLocation,
  pathEncodedLocation,
  type TenantFileLocation,
} from "@/lib/crypto/tenant-file-backfill"
import { runtimePrivateUploadDirectory, runtimePublicUploadDirectory } from "@/lib/runtime-paths"
import { mobileDocumentStorageRoot } from "@/lib/mtm/mobile-document"
import { MTM_PHOTO_THUMBNAIL_DIR } from "@/lib/mtm/photo-thumbnail-server"

// Customer files only. Logos, email images and social logos are public by
// design and stay plain (see tenant-file-readers-guard.test.ts).
const PATH_ENCODED_SUBDIRS = ["inbox", "web-chat", "whatsapp", "telegram", "contract-images", "avatars", "mtm-invoices"] as const

// The exported prisma client is untyped here, so rows are typed at the call.
function ownersBy<T extends { organizationId: string }>(key: (row: T) => string) {
  return (rows: T[]) => new Map<string, string>(rows.map((row) => [key(row), row.organizationId]))
}

export function tenantFileLocations(): TenantFileLocation[] {
  const photoUrl = (name: string) => `/uploads/mtm-photos/${name}`
  const photoOwners = async (names: string[]) => {
    const rows: Array<{ url: string; organizationId: string }> = await prisma.mtmPhoto.findMany({
      where: { url: { in: names.map(photoUrl) } },
      select: { url: true, organizationId: true },
    })
    return new Map<string, string>(rows.map((row) => [row.url.slice(photoUrl("").length), row.organizationId]))
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
