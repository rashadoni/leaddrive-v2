/**
 * .docx (ZIP) decompression-bomb preflight (Slice 1, Step 6 — Codex HIGH).
 *
 * A .docx is a ZIP. mammoth/jszip inflates each entry into memory during parse,
 * with no uncompressed-size policy — so a small compressed upload can inflate to
 * hundreds of MB before our post-conversion 1 MB HTML cap runs, OOM-ing a shared
 * multi-tenant box.
 *
 * `declaredUncompressedSize` sums the uncompressed sizes the ZIP *declares* in
 * its central directory, WITHOUT decompressing anything — a cheap upper-bound
 * gate that rejects honestly-built bombs and accidental giant documents before
 * mammoth allocates. (A maliciously *under-declared* size is still caught by
 * jszip's own post-inflate length check, and the route's rate-limit + lowered
 * upload cap bound the residual; the fully-robust per-entry capped inflate is
 * tracked as a [P2] in deferred_findings.)
 *
 * Returns the declared total in bytes, or `null` when the ZIP structure can't be
 * parsed (caller passes those through to mammoth, which rejects bad files) —
 * never throws, so it can't itself become a parse-time crash vector.
 */

const EOCD_SIG = 0x06054b50 // End Of Central Directory record
const CDH_SIG = 0x02014b50 // Central Directory file Header
const ZIP64_SENTINEL = 0xffffffff // a size/offset of 0xFFFFFFFF defers to ZIP64

export function declaredUncompressedSize(buf: Buffer): number | null {
  if (buf.length < 22) return null

  // Find the EOCD by scanning backward from the minimum record position
  // (22 bytes) across the max comment length (65535).
  let eocd = -1
  const scanFloor = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= scanFloor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null

  const cdCount = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  // ZIP64 (>=0xFFFF entries or 0xFFFFFFFF offset) → treat as oversized: a real
  // ZIP64 .docx is far beyond any legitimate contract.
  if (cdCount === 0xffff || cdOffset === ZIP64_SENTINEL) return Number.POSITIVE_INFINITY

  let total = 0
  let p = cdOffset
  for (let n = 0; n < cdCount; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CDH_SIG) return null // malformed → pass through
    const uncompressed = buf.readUInt32LE(p + 24)
    if (uncompressed === ZIP64_SENTINEL) return Number.POSITIVE_INFINITY
    total += uncompressed
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    p += 46 + nameLen + extraLen + commentLen
  }
  return total
}

/** Inflated-size ceiling for an imported .docx. 80 MB ≈ a very large real
 *  contract with embedded media; bombs declare far more. */
export const MAX_DOCX_UNCOMPRESSED = 80 * 1024 * 1024
