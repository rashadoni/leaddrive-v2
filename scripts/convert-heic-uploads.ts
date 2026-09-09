export {}

/**
 * One-shot migration: convert existing .heic uploads on disk to .jpg
 * and update mtm_photos.url to point at the new filename.
 *
 * Runs on the production server (or any node with DATABASE_URL set):
 *   ssh root@<server>
 *   cd /opt/leaddrive-v2
 *   NODE_ENV=production node --env-file=/etc/leaddrive/app.env \
 *     --import tsx scripts/convert-heic-uploads.ts            # dry-run
 *   NODE_ENV=production node --env-file=/etc/leaddrive/app.env \
 *     --import tsx scripts/convert-heic-uploads.ts --apply    # actually convert
 *
 * Each row scanned:
 *   • url ends with .heic
 *   • file exists in the canonical runtime upload root
 *   • converted to .jpg via heic-convert
 *   • original .heic kept for rollback (delete manually after smoke)
 *   • DB row updated to new .jpg url
 *
 * Safe to re-run — already-converted rows are skipped.
 */

import type { PrismaClient } from "@prisma/client"
import { makeScriptPrisma } from "./_rls.mjs"
import { readFile, writeFile, access } from "fs/promises"
import { constants } from "fs"
import path from "path"
import heicConvert from "heic-convert"
import { resolveRuntimePaths } from "../src/lib/runtime-paths"

let prisma!: PrismaClient
const APPLY = process.argv.includes("--apply")
// Optional `--limit=N` cap on rows processed per run. Architect-suggested
// safety knob: convert 10 → smoke-check in browser → full sweep.
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="))
const LIMIT = LIMIT_ARG ? Math.max(1, parseInt(LIMIT_ARG.split("=")[1], 10) || 0) : Infinity
const UPLOAD_DIR = `${resolveRuntimePaths({
  ...process.env,
  // This is a production migration utility. Its default must never silently
  // write into the checkout merely because an interactive shell lacks NODE_ENV.
  NODE_ENV: process.env.NODE_ENV || "production",
}).publicUploadsRoot}/mtm-photos`
// Mirror of HEIC_JPEG_QUALITY in src/app/api/v1/mtm/photos/route.ts so
// re-encodes match new uploads.
const JPEG_QUALITY = 0.85

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function main() {
  prisma = await makeScriptPrisma()
  const allRows = await prisma.mtmPhoto.findMany({
    where: { url: { endsWith: ".heic" } },
    select: { id: true, url: true },
    orderBy: { createdAt: "asc" },
  })

  if (allRows.length === 0) {
    console.log("No .heic rows in mtm_photos — nothing to migrate.")
    return
  }
  const rows = LIMIT === Infinity ? allRows : allRows.slice(0, LIMIT)
  console.log(`Found ${allRows.length} .heic photo row(s); processing ${rows.length} this run.`)
  if (!APPLY) console.log("DRY-RUN — pass --apply to convert + update DB.\n")

  let converted = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    const heicName = row.url.split("/").pop() || ""
    const heicPath = path.join(UPLOAD_DIR, heicName)
    if (!(await fileExists(heicPath))) {
      console.log(`  ⚠️  ${row.id} → ${heicName} missing on disk; skipped.`)
      skipped++
      continue
    }
    const jpgName = heicName.replace(/\.heic$/i, ".jpg")
    const jpgPath = path.join(UPLOAD_DIR, jpgName)
    const newUrl = row.url.replace(/\.heic$/i, ".jpg")

    console.log(`  ${APPLY ? "→" : "[dry]"} ${row.id}: ${heicName} → ${jpgName}`)
    if (!APPLY) {
      converted++
      continue
    }

    try {
      const heicBuffer = await readFile(heicPath)
      const jpegArrayBuf = await heicConvert({ buffer: heicBuffer, format: "JPEG", quality: JPEG_QUALITY })
      const jpegBuffer = Buffer.from(jpegArrayBuf)
      await writeFile(jpgPath, jpegBuffer)
      await prisma.mtmPhoto.update({ where: { id: row.id }, data: { url: newUrl } })
      // Per-row size log so failed decodes (returning tiny stubs) are visible.
      console.log(`    in=${heicBuffer.length}b out=${jpegBuffer.length}b`)
      converted++
    } catch (e: any) {
      console.error(`  ❌ ${row.id} failed: ${e.message}`)
      failed++
    }
  }

  console.log(`\nResult: converted=${converted}, skipped=${skipped}, failed=${failed} (of ${rows.length}).`)
  if (APPLY && converted > 0) {
    console.log(`\nOriginals (.heic) kept on disk for rollback. After smoke-test:`)
    console.log(`  find ${UPLOAD_DIR} -name '*.heic' -delete`)
  }
}

main()
  .catch((e) => {
    console.error("Migration failed:", e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
