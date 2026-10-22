/**
 * Customer files are tenant-encrypted envelopes on disk
 * (`src/lib/crypto/tenant-file-encryption.ts`).
 *
 * Readers: a module that reads bytes from an upload directory without
 * decoding would hand ciphertext to a browser, a channel or a thumbnailer.
 * Writers: a module that writes there without sealing would quietly put a
 * customer's file back on disk in the clear.
 *
 * The guard finds every source file that names an upload location and reads
 * or writes a file, and requires the decoder / sealer — or an entry below
 * with the reason that location is plain by design.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(__dirname, "..")

const UPLOAD_LOCATION = /runtimePublicUpload|runtimePrivateUpload|resolveMobileDocumentStoragePath|resolveTicketAttachmentPath|attendanceAttachmentPath|privateUploadsRoot|publicUploadsRoot/
const FILE_READ = /\breadFile\(|\bcreateReadStream\(|\.readFile\(\)/
const DECODER = /from "@\/lib\/crypto\/tenant-file-encryption"|storedMobileDocumentBytes\(/
const FILE_WRITE = /\bwriteFile\(|\bcreateWriteStream\(/
const SEALER = /\bsealTenantFile\(/

/** Readers whose files are plain by design. Adding one needs a reason. */
const PLAIN_BY_DESIGN = new Map<string, string>([
  // Short-lived SMTP attachments in email-attachments/ or tmp, deleted after the send.
  ["lib/email.ts", "transient outbound mail attachments"],
  // A cache of images downloaded from public social posts, re-fetchable by URL.
  ["lib/social/media-preview-cache.ts", "cache of already-public social media"],
])

/** Writers whose files are plain by design. Adding one needs a reason. */
const PLAIN_WRITERS = new Map<string, string>([
  // Served without a session (email clients, login page): encryption would protect nothing.
  ["app/api/v1/admin/upload-logo/route.ts", "public tenant logos"],
  ["app/api/v1/email-templates/upload-image/route.ts", "public email images"],
  ["app/api/v1/social/monitoring-profiles/[id]/logo/route.ts", "brand logos of monitored profiles"],
  // Deleted right after the SMTP send.
  ["app/api/v1/deals/[id]/send-email/route.ts", "transient outbound mail attachments"],
  ["lib/social/media-preview-cache.ts", "cache of already-public social media"],
])

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name)
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

describe("uploaded-file readers decode tenant envelopes", () => {
  const readers = sourceFiles(ROOT)
    .map((file) => ({ file: path.relative(ROOT, file), text: readFileSync(file, "utf8") }))
    .filter(({ text }) => UPLOAD_LOCATION.test(text) && FILE_READ.test(text))

  it("finds the readers it is meant to watch", () => {
    // If this drops, the patterns above stopped matching and the guard is blind.
    expect(readers.length).toBeGreaterThanOrEqual(8)
  })

  it("every reader of an upload location goes through the decoder", () => {
    const undecoded = readers
      .filter(({ file, text }) => !DECODER.test(text) && !PLAIN_BY_DESIGN.has(file))
      .map(({ file }) => file)
    expect(undecoded).toEqual([])
  })

  it("the plain-by-design list names files that still exist and still read", () => {
    const names = new Set(readers.map(({ file }) => file))
    expect([...PLAIN_BY_DESIGN.keys()].filter((file) => !names.has(file))).toEqual([])
  })
})

describe("uploaded-file writers seal for the tenant", () => {
  const writers = sourceFiles(ROOT)
    .map((file) => ({ file: path.relative(ROOT, file), text: readFileSync(file, "utf8") }))
    .filter(({ text }) => UPLOAD_LOCATION.test(text) && FILE_WRITE.test(text))

  it("finds the writers it is meant to watch", () => {
    expect(writers.length).toBeGreaterThanOrEqual(15)
  })

  it("every writer to an upload location seals the bytes", () => {
    const unsealed = writers
      .filter(({ file, text }) => !SEALER.test(text) && !PLAIN_WRITERS.has(file))
      .map(({ file }) => file)
    expect(unsealed).toEqual([])
  })

  it("the plain-writer list names files that still exist and still write", () => {
    const names = new Set(writers.map(({ file }) => file))
    expect([...PLAIN_WRITERS.keys()].filter((file) => !names.has(file))).toEqual([])
  })
})
