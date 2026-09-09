/**
 * F-41: runtime-uploaded file proxy.
 *
 * Next.js `output: "standalone"` builds a static-file manifest at build
 * time and refuses to serve anything added to `public/` after that —
 * runtime uploads (mtm-photos, contracts, logos, …) write to a symlink
 * (F-40) but the bundled server returns 404 because the file wasn't in
 * the build snapshot.
 *
 * This API route reads the file straight off disk + streams it back
 * with the right Content-Type. `next.config.ts` rewrites
 *   /uploads/:path*  →  /api/v1/uploads/:path*
 * so DB rows that already store `/uploads/mtm-photos/foo.jpg` keep
 * working without any data migration.
 *
 * Security: private subdirs require a browser session plus module/tenant
 * authorization. Anonymous reads are limited to new, strictly named,
 * decode/re-encoded email images and tenant logos. Path traversal is blocked
 * before resolving the canonical serving path.
 */

import { NextRequest, NextResponse } from "next/server"
import { stat } from "fs/promises"
import { createReadStream } from "fs"
import { Readable } from "stream"
import path from "path"
import { prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { orgHasModule } from "@/lib/api-auth"
import {
  checkPermission,
  PERMISSION_MODULE_TO_MODULE_ID,
  type Module,
} from "@/lib/permissions"
import type { ModuleId } from "@/lib/modules"
import {
  acquirePublicConcurrencySlot,
  consumePublicRateLimit,
  releasePublicConcurrencySlot,
} from "@/lib/public-abuse-guard"
import { clientIp } from "@/lib/request-ip"
import {
  isCanonicalPublicUploadPath,
  isSafeUploadPathParts,
  PATH_ENCODED_ORG_SUBDIRS,
  PROXIED_UPLOAD_SUBDIR_SET,
} from "@/lib/upload-path-policy"
import { mtmMediaObjectReadFailureResponse } from "@/lib/mtm/media-object-http"
import { readCommittedMtmMediaObject, toMtmReservedMediaObject } from "@/lib/mtm/media-object-lifecycle"
import { mtmMediaObjectStorageSelect } from "@/lib/mtm/media-object-select"
import { runtimePublicUploadsRoot } from "@/lib/runtime-paths"

const MAX_SERVED_FILE_SIZE = 50 * 1024 * 1024
const MAX_PUBLIC_SERVED_FILE_SIZE = 6 * 1024 * 1024
const DOWNLOAD_RATE_POLICY = { maxRequests: 120, windowSeconds: 60 }
const DOWNLOAD_CONCURRENCY_POLICY = { maxConcurrent: 8, leaseSeconds: 300 }
const PUBLIC_DOWNLOAD_RATE_POLICY = { maxRequests: 240, windowSeconds: 60 }
const PUBLIC_DOWNLOAD_CONCURRENCY_POLICY = { maxConcurrent: 12, leaseSeconds: 120 }

type RouteContext = { params: Promise<{ path: string[] }> }

// A tenant match is necessary but not sufficient: users without a module's
// read permission must not fetch its files just because they learned a URL.
// Avatars are personal self-service data and logos are shared tenant chrome,
// so those two intentionally have no product-module requirement here.
const SUBDIR_READ_MODULE = new Map<string, Module>([
  ["mtm-photos", "mtm"],
  ["mtm-invoices", "mtm"],
  ["contracts", "contracts"],
  ["contract-images", "contracts"],
  ["tasks", "tasks"],
  ["email-images", "campaigns"],
  ["web-chat", "inbox"],
  ["whatsapp", "inbox"],
  ["telegram", "inbox"],
  ["inbox", "inbox"],
  ["social-logos", "social"],
])

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  // F-41 must-fix: contracts allow doc/docx/xls/xlsx/ppt/pptx/txt/csv/zip/rar
  // (see src/app/api/v1/contracts/[id]/files/route.ts:25). Without these the
  // browser sees application/octet-stream and triggers Save-As instead of
  // inline preview / Office viewer.
  doc:  "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls:  "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt:  "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv:  "text/csv",
  txt:  "text/plain",
  zip:  "application/zip",
  rar:  "application/vnd.rar",
}

function mimeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || ""
  return MIME[ext] || "application/octet-stream"
}

// Architect-suggested: render previewable types inline (browsers + Office
// Online), force download for archives so a malformed file can't trigger
// browser-side execution / decompression UI surprises.
//
// Keep FORCE_ATTACHMENT_EXTS in sync with the archive entries in
// SAFE_EXTENSIONS at src/app/api/v1/contracts/[id]/files/route.ts:25.
// If 7z/tar/gz get whitelisted there, add them here too.
const FORCE_ATTACHMENT_EXTS = new Set(["zip", "rar", "svg"])
function dispositionFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || ""
  // Filename in Content-Disposition gets quoted to survive spaces/unicode.
  // We don't escape further because the upload route already strips
  // anything outside [a-z0-9._-] from filenames at write-time.
  const quoted = `"${filename.replace(/[\\"]/g, "_")}"`
  // Defense in depth: force `attachment` for archives AND for any
  // extension that wasn't in the MIME table. Unknown bytes fall through
  // to application/octet-stream and must never render inline — a
  // malformed `.html` or `.svgz` slipping past the upload whitelist
  // shouldn't get to execute in the gallery.
  const force = FORCE_ATTACHMENT_EXTS.has(ext) || !(ext in MIME)
  return `${force ? "attachment" : "inline"}; filename=${quoted}`
}

async function serveUploadFile(
  parts: readonly string[],
  access: { public: boolean; principal: string },
): Promise<NextResponse> {
  // Recheck the lexical policy at the last boundary before path.resolve. Both
  // public and authenticated dispatchers call this helper, and neither is
  // allowed to turn separators or dot segments into a different disk target.
  if (!isSafeUploadPathParts(parts) || !PROXIED_UPLOAD_SUBDIR_SET.has(parts[0])) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const uploadsRoot = runtimePublicUploadsRoot()
  const filePath = path.resolve(uploadsRoot, ...parts)
  if (!filePath.startsWith(uploadsRoot + path.sep)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (!fileStat.isFile()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const sizeLimit = access.public ? MAX_PUBLIC_SERVED_FILE_SIZE : MAX_SERVED_FILE_SIZE
  if (fileStat.size < 0 || fileStat.size > sizeLimit) {
    return NextResponse.json({ error: "File is too large to serve" }, { status: 413 })
  }

  const limiterNamespace = access.public ? "uploads:public:get" : "uploads:get"
  const slot = await acquirePublicConcurrencySlot(
    limiterNamespace,
    access.principal,
    access.public ? PUBLIC_DOWNLOAD_CONCURRENCY_POLICY : DOWNLOAD_CONCURRENCY_POLICY,
  )
  if (!slot.allowed) {
    return NextResponse.json(
      { error: slot.unavailable ? "Download protection temporarily unavailable" : "Too many concurrent downloads" },
      {
        status: slot.unavailable ? 503 : 429,
        headers: { "Retry-After": String(slot.retryAfterSeconds) },
      },
    )
  }

  const filename = parts.at(-1) ?? "download"
  const extension = filename.split(".").pop()?.toLowerCase() || ""
  const headers: Record<string, string> = {
    "Content-Type": mimeFor(filename),
    "Content-Length": String(fileStat.size),
    "Content-Disposition": dispositionFor(filename),
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": access.public ? "cross-origin" : "same-origin",
    "Referrer-Policy": "no-referrer",
    ...(access.public
      ? {
          // Canonical public names contain 128 bits of randomness and are never
          // overwritten, so long-lived shared caching cannot replay a changed
          // object. Cross-origin fetches are required for remote email clients.
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Security-Policy": "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          "X-Frame-Options": "DENY",
        }
      : {
          // Authenticated files must never survive logout, tenant changes, or
          // session revocation in a browser or intermediary cache.
          "Cache-Control": "private, no-store",
          "Vary": "Cookie, Authorization",
        }),
  }
  if (!access.public && extension === "svg") {
    // Legacy SVGs may contain script/event handlers. They are no longer
    // accepted by upload routes; force old files to download and sandbox any
    // browser that still elects to render the response.
    headers["Content-Security-Policy"] = "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    headers["X-Frame-Options"] = "DENY"
  }

  let fileStream: ReturnType<typeof createReadStream>
  try {
    fileStream = createReadStream(filePath, { highWaterMark: 64 * 1024 })
  } catch {
    await releasePublicConcurrencySlot(slot)
    return NextResponse.json({ error: "Failed to open file" }, { status: 500 })
  }
  // Node's file stream applies backpressure through the Web stream adapter;
  // no file-sized Buffer is materialized. Close fires on EOF, error, or client
  // cancellation. The Redis lease is the final safety net for abrupt crashes.
  fileStream.once("close", () => {
    void releasePublicConcurrencySlot(slot)
  })
  const body = Readable.toWeb(fileStream) as ReadableStream<Uint8Array>

  return new NextResponse(body, { status: 200, headers })
}

/**
 * Object-backed photos preserve the old authenticated `/uploads/mtm-photos/*`
 * URL shape, but their bytes never visit the legacy public/uploads directory.
 * Authorization happens before this helper; an object read never falls back
 * to disk when the attached metadata says object storage is authoritative.
 */
async function serveMtmObjectPhoto(input: {
  fileName: string
  mediaObject: Parameters<typeof toMtmReservedMediaObject>[0]
  principal: string
}): Promise<NextResponse> {
  const slot = await acquirePublicConcurrencySlot(
    "uploads:get",
    input.principal,
    DOWNLOAD_CONCURRENCY_POLICY,
  )
  if (!slot.allowed) {
    return NextResponse.json(
      { error: slot.unavailable ? "Download protection temporarily unavailable" : "Too many concurrent downloads" },
      {
        status: slot.unavailable ? 503 : 429,
        headers: { "Retry-After": String(slot.retryAfterSeconds) },
      },
    )
  }
  try {
    const bytes = await readCommittedMtmMediaObject({ mediaObject: toMtmReservedMediaObject(input.mediaObject) })
    if (bytes.byteLength > MAX_SERVED_FILE_SIZE) {
      return NextResponse.json({ error: "File is too large to serve" }, { status: 413 })
    }
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": mimeFor(input.fileName),
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": dispositionFor(input.fileName),
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "private, no-store",
        "Vary": "Cookie, Authorization",
      },
    })
  } catch (error) {
    const response = mtmMediaObjectReadFailureResponse(error)
    if (response) return response
    throw error
  } finally {
    await releasePublicConcurrencySlot(slot)
  }
}

const authenticatedGET = withRlsSessionAuth(async (_req, auth, { params }: RouteContext) => {
  // F-41 must-fix: gate behind a real browser session so anonymous scrapers
  // and API keys cannot pull personal files by treating the key creator's
  // audit id as an impersonation grant. Same-origin <img>/<a> requests carry
  // the session cookie automatically.
  //
  // Gate authenticated users so anonymous scrapers can't
  // pull mtm-photos / contracts with a guessable-via-leak URL. Upload + delete
  // routes already requireAuth; GET was the only unauthenticated path.
  //
  // Canonical nginx configs must proxy every `/uploads/*` request through
  // this route; a filesystem alias would bypass both this session gate and
  // the narrow public-name dispatcher. See nginx-uploads-drift.md for the
  // resolved production drift and its verification procedure.

  // Shared Redis budget prevents PM2 worker-hopping. A typical gallery can fan
  // out to dozens of images, so 120/min keeps UI headroom while bounding scans.
  const rate = await consumePublicRateLimit(
    "uploads:get",
    `${auth.orgId}:${auth.userId}`,
    DOWNLOAD_RATE_POLICY,
  )
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rate.unavailable ? "Download protection temporarily unavailable" : "Too many requests" },
      {
        status: rate.unavailable ? 503 : 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    )
  }

  const { path: parts } = await params
  if (!parts || parts.length < 2) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Authorize exactly the same lexical path that will be read. If dot or
  // separator-bearing segments reach path.resolve, a request can pass one
  // subdir's cheap org guard and then resolve into another subdir that has a
  // stronger DB ownership check (for example email-images/own/../../contracts).
  if (!isSafeUploadPathParts(parts)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const [subdir] = parts
  if (!PROXIED_UPLOAD_SUBDIR_SET.has(subdir)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const requiredModule = SUBDIR_READ_MODULE.get(subdir)
  if (requiredModule) {
    const moduleId = (PERMISSION_MODULE_TO_MODULE_ID[requiredModule] ?? requiredModule) as ModuleId
    const roleCanRead = checkPermission(auth.role, requiredModule, "read")
    const orgCanRead = auth.role === "superadmin" || await orgHasModule(auth.orgId, moduleId)
    if (!roleCanRead || !orgCanRead) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
  }

  // Cross-tenant guard — Task #65 follow-up
  // (`docs/security/nginx-uploads-drift.md`). Without this, any
  // authenticated user from tenant A could fetch tenant B's files in
  // the shared `/uploads/<subdir>/` namespace by guessing or learning
  // the filename. The guard splits into two patterns:
  //
  //   Path-encoded subdirs — the path itself carries `<orgId>` as the
  //   first segment after the subdir. Cheap: just assert it matches
  //   the caller's org. Used by `mtm-invoices` (M2-2c, original
  //   pattern), `email-images`, `web-chat`, and re-encoded `avatars`.
  //
  //   DB-resolved subdirs — the path is a bare filename; ownership
  //   lives in a DB row (`MtmPhoto.url` / `ContractFile.fileName`).
  //   Look up the row by filename + assert `organizationId` match.
  //
  // `logos/` has no tenant segment because a superadmin can upload a logo
  // before creating/assigning a tenant. The outer dispatcher permits only the
  // new canonical decode/re-encoded names anonymously; legacy logo names reach
  // this authenticated branch and remain private pending inventory/migration.
  if (PATH_ENCODED_ORG_SUBDIRS.has(subdir)) {
    const pathOrgId = parts[1] ?? ""
    if (!pathOrgId || pathOrgId !== auth.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    // Pre-remediation avatar files contain the original attacker-controlled
    // bytes and used a shorter random name with their submitted extension.
    // Only the new decode/re-encode pipeline emits this exact shape. Keeping
    // the serving boundary strict quarantines all legacy avatar bytes without
    // deleting them or accidentally publishing them during the persistence
    // symlink rollout.
    if (
      subdir === "avatars"
      && (parts.length !== 3 || !/^av-[0-9a-f]{32}\.webp$/.test(parts[2] ?? ""))
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
  } else if (subdir === "mtm-photos") {
    // Bare-filename layout: /uploads/mtm-photos/<file>. MtmPhoto.url is
    // stored as the full `/uploads/mtm-photos/<file>` path — match on
    // that and scope to caller's org. A miss returns the same 404
    // shape so cross-tenant probes can't distinguish "file exists but
    // not yours" from "doesn't exist".
    const fileName = parts[1] ?? ""
    if (!fileName) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const photo = await prisma.mtmPhoto.findFirst({
      where: { url: `/uploads/mtm-photos/${fileName}`, organizationId: auth.orgId },
      select: { id: true, mediaObject: { select: mtmMediaObjectStorageSelect } },
    })
    if (!photo) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (photo.mediaObject) {
      return serveMtmObjectPhoto({
        fileName,
        mediaObject: photo.mediaObject,
        principal: `${auth.orgId}:${auth.userId}`,
      })
    }
  } else if (subdir === "contracts") {
    // Bare-filename layout: /uploads/contracts/<file>. ContractFile
    // owns the row; `fileName` column holds the stored unique name.
    const fileName = parts[1] ?? ""
    if (!fileName) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const cf = await prisma.contractFile.findFirst({
      where: { fileName, organizationId: auth.orgId },
      select: { id: true },
    })
    if (!cf) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
  } else if (subdir === "tasks") {
    // Bare-filename layout: /uploads/tasks/<file>. TaskAttachment owns the
    // row; `fileName` holds the stored unique name. Same masked-404 on a
    // cross-tenant miss as contracts.
    const fileName = parts[1] ?? ""
    if (!fileName) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    const ta = await prisma.taskAttachment.findFirst({
      where: { fileName, organizationId: auth.orgId },
      select: { id: true },
    })
    if (!ta) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
  }
  // `logos` falls through to the disk-read below — no cross-tenant
  // check (intentionally), see comment above.

  return serveUploadFile(parts, {
    public: false,
    principal: `${auth.orgId}:${auth.userId}`,
  })
})

export async function GET(req: NextRequest, context: RouteContext): Promise<Response> {
  let parts: string[]
  try {
    const candidate = (await context.params).path
    if (!Array.isArray(candidate)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    parts = candidate
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // Only hardened immutable raster outputs bypass session auth. Any legacy
  // logo/email image name, malformed public-looking path, or private subdir is
  // delegated to the unchanged session/module/org authorization path below.
  if (!isCanonicalPublicUploadPath(parts)) {
    return authenticatedGET(req, context)
  }

  const principal = `ip:${clientIp(req)}`
  const rate = await consumePublicRateLimit(
    "uploads:public:get",
    principal,
    PUBLIC_DOWNLOAD_RATE_POLICY,
  )
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rate.unavailable ? "Download protection temporarily unavailable" : "Too many requests" },
      {
        status: rate.unavailable ? 503 : 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    )
  }

  return serveUploadFile(parts, { public: true, principal })
}
