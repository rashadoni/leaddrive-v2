/**
 * Uploaded files may be tenant-encrypted envelopes on disk
 * (`src/lib/crypto/tenant-file-encryption.ts`). A module that reads bytes from
 * an upload directory without decoding would hand ciphertext to a browser, a
 * channel or a thumbnailer. This guard finds every source file that both
 * names an upload location and reads a file, and requires it to use the
 * decoder — or to be listed below with the reason its files are never
 * encrypted.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(__dirname, "..")

const UPLOAD_LOCATION = /runtimePublicUpload|runtimePrivateUpload|resolveMobileDocumentStoragePath|resolveTicketAttachmentPath|attendanceAttachmentPath|privateUploadsRoot|publicUploadsRoot/
const FILE_READ = /\breadFile\(|\bcreateReadStream\(|\.readFile\(\)/
const DECODER = /from "@\/lib\/crypto\/tenant-file-encryption"|storedMobileDocumentBytes\(/

/** Readers whose files are plain by design. Adding one needs a reason. */
const PLAIN_BY_DESIGN = new Map<string, string>([
  // Short-lived SMTP attachments in email-attachments/ or tmp, deleted after the send.
  ["lib/email.ts", "transient outbound mail attachments"],
  // A cache of images downloaded from public social posts, re-fetchable by URL.
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
