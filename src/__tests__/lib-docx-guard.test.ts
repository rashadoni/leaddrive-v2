/**
 * .docx zip-bomb preflight (Slice 1, Step 6 — Codex HIGH).
 *
 * `declaredUncompressedSize` sums the uncompressed sizes a ZIP's central
 * directory DECLARES, without decompressing. Fixtures are hand-crafted
 * CDH+EOCD records (the parser never reads local file headers or data).
 *
 * Coverage: sum over entries, ZIP64 sentinels → Infinity, trailing-comment
 * EOCD discovery, malformed/garbage/short buffers → null (pass-through).
 */
import { describe, it, expect } from "vitest"
import { declaredUncompressedSize, MAX_DOCX_UNCOMPRESSED } from "@/lib/clm/docx-guard"

const CDH_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const ZIP64 = 0xffffffff

/** Central Directory file Header (46 bytes + name). */
function cdh(name: string, uncompressed: number): Buffer {
  const nameBuf = Buffer.from(name, "utf8")
  const b = Buffer.alloc(46 + nameBuf.length)
  b.writeUInt32LE(CDH_SIG, 0)
  b.writeUInt32LE(uncompressed >>> 0, 24) // uncompressed size
  b.writeUInt16LE(nameBuf.length, 28) // file name length
  // extra(30) + comment(32) lengths stay 0
  nameBuf.copy(b, 46)
  return b
}

/** End Of Central Directory record (22 bytes + optional comment). */
function eocd(cdCount: number, cdOffset: number, comment = ""): Buffer {
  const commentBuf = Buffer.from(comment, "utf8")
  const b = Buffer.alloc(22 + commentBuf.length)
  b.writeUInt32LE(EOCD_SIG, 0)
  b.writeUInt16LE(Math.min(cdCount, 0xffff), 8) // entries on this disk
  b.writeUInt16LE(Math.min(cdCount, 0xffff), 10) // entries total
  b.writeUInt32LE(cdOffset >>> 0, 16) // central directory offset
  b.writeUInt16LE(commentBuf.length, 20)
  commentBuf.copy(b, 22)
  return b
}

function zipOf(entries: Array<[string, number]>, comment = ""): Buffer {
  const cds = entries.map(([n, s]) => cdh(n, s))
  const cd = Buffer.concat(cds)
  // central directory at offset 0 (no local headers — the parser doesn't read them)
  return Buffer.concat([cd, eocd(entries.length, 0, comment)])
}

describe("declaredUncompressedSize", () => {
  it("sums the declared uncompressed sizes across entries", () => {
    const zip = zipOf([
      ["word/document.xml", 1000],
      ["word/styles.xml", 2000],
      ["[Content_Types].xml", 500],
    ])
    expect(declaredUncompressedSize(zip)).toBe(3500)
  })

  it("finds the EOCD behind a trailing comment", () => {
    const zip = zipOf([["word/document.xml", 1234]], "trailing zip comment")
    expect(declaredUncompressedSize(zip)).toBe(1234)
  })

  it("a bomb-sized declaration is reported, not hidden", () => {
    const zip = zipOf([["word/media/huge.bin", 500 * 1024 * 1024]])
    expect(declaredUncompressedSize(zip)).toBe(500 * 1024 * 1024)
    expect(declaredUncompressedSize(zip)! > MAX_DOCX_UNCOMPRESSED).toBe(true)
  })

  it("ZIP64 size sentinel → Infinity (treated as oversized)", () => {
    const zip = zipOf([["word/document.xml", ZIP64]])
    expect(declaredUncompressedSize(zip)).toBe(Number.POSITIVE_INFINITY)
  })

  it("ZIP64 EOCD sentinels (entry count / cd offset) → Infinity", () => {
    const byCount = Buffer.concat([cdh("a", 1), eocd(0xffff, 0)])
    expect(declaredUncompressedSize(byCount)).toBe(Number.POSITIVE_INFINITY)
    const byOffset = Buffer.concat([cdh("a", 1), eocd(1, ZIP64)])
    expect(declaredUncompressedSize(byOffset)).toBe(Number.POSITIVE_INFINITY)
  })

  it("garbage buffer → null (pass-through to mammoth's own rejection)", () => {
    expect(declaredUncompressedSize(Buffer.from("this is not a zip file at all, just text padding to pass 22 bytes"))).toBeNull()
  })

  it("buffer shorter than an EOCD → null", () => {
    expect(declaredUncompressedSize(Buffer.from("PK\x03\x04"))).toBeNull()
  })

  it("malformed central directory (offset points at junk) → null", () => {
    // EOCD claims 2 entries at offset 0, but the bytes there aren't CDH records.
    const junk = Buffer.alloc(50, 0xab)
    const broken = Buffer.concat([junk, eocd(2, 0)])
    expect(declaredUncompressedSize(broken)).toBeNull()
  })

  it("empty archive (0 entries) → 0", () => {
    expect(declaredUncompressedSize(eocd(0, 0))).toBe(0)
  })
})
