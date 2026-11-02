/**
 * The open demo streams the clips filmed on the invented demo stand to a
 * visitor with no session (owner decision 2026-09-22), and nothing else.
 *
 * The bytes left the repository on 2026-11-02 — production pulls them from
 * object storage — so this suite serves stand-in files from a temporary
 * directory and keeps asserting what the route does: who gets a 200, which
 * headers, how it answers a Range, and which names it refuses. The refusals
 * stay meaningful because the refused names are written to disk too: a 404
 * can then only come from the allowlist, never from a missing file.
 *
 * That every offered clip really exists is a separate claim, proved against
 * the committed master manifest — the same list the deploy pulls against.
 */
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { GET as getOpenClip } from "@/app/api/v1/public/demo-clips/[file]/route"
import { DEMO_PUBLIC_CLIP_SLUGS, DEMO_PUBLIC_CLIPS_VERSION, demoPublicClipUrl } from "@/lib/demo-center/journey"
import { manifestNames } from "../../scripts/help-video/sync-video-availability.mjs"

const MASTERS: Set<string> = manifestNames()

/** Clips the allowlist must refuse even though the file is right there. */
const REFUSED_BUT_PRESENT = [
  "deal-detail.az.VOICE.mp4", // played by the story, but filmed on LeadDrive Inc.'s test records
  "quotes.az.poster.jpg",
  "leads.az.VOICE.mp4",
  "demo-campaigns.en.VOICE.mp4", // a real file in the library: only az is public
]

let assetDir = ""
let previousAssetDir: string | undefined

function get(file: string, headers: Record<string, string> = {}) {
  return getOpenClip(
    new NextRequest(new URL(`/api/v1/public/demo-clips/${encodeURIComponent(file)}`, "http://localhost:3000"), { headers }),
    { params: Promise.resolve({ file }) },
  )
}

beforeAll(() => {
  assetDir = mkdtempSync(path.join(tmpdir(), "demo-open-clips-"))
  previousAssetDir = process.env.HELP_VIDEO_ASSET_DIR
  process.env.HELP_VIDEO_ASSET_DIR = assetDir

  // A different size per name, larger than the range the seek test asks for,
  // so a Content-Length read off the wrong file would fail the assertion.
  let size = 4096
  for (const name of [
    ...[...DEMO_PUBLIC_CLIP_SLUGS].flatMap((slug) => [`${slug}.az.VOICE.mp4`, `${slug}.az.poster.jpg`]),
    ...REFUSED_BUT_PRESENT,
  ]) {
    writeFileSync(path.join(assetDir, name), Buffer.alloc((size += 17)))
  }
})

afterAll(() => {
  if (previousAssetDir === undefined) delete process.env.HELP_VIDEO_ASSET_DIR
  else process.env.HELP_VIDEO_ASSET_DIR = previousAssetDir
  rmSync(assetDir, { recursive: true, force: true })
})

describe("the open demo's public clips", () => {
  it("serves each stand clip and its poster to anyone, cacheable", async () => {
    for (const slug of DEMO_PUBLIC_CLIP_SLUGS) {
      for (const [suffix, type] of [["VOICE.mp4", "video/mp4"], ["poster.jpg", "image/jpeg"]] as const) {
        const file = `${slug}.az.${suffix}`
        const response = await get(file)
        expect(response.status, file).toBe(200)
        expect(response.headers.get("content-type"), file).toBe(type)
        expect(response.headers.get("cache-control"), file).toBe("public, max-age=86400")
        expect(Number(response.headers.get("content-length")), file).toBe(statSync(path.join(assetDir, file)).size)
      }
    }
  })

  it("answers a range request, so the player can seek", async () => {
    const response = await get("demo-leads.az.VOICE.mp4", { range: "bytes=0-1023" })
    expect(response.status).toBe(206)
    expect(response.headers.get("content-length")).toBe("1024")
  })

  it("refuses the help library's clips, other languages and anything else", async () => {
    for (const file of [
      ...REFUSED_BUT_PRESENT,
      "demo-campaigns.az.srt",
      "..%2Fdemo-campaigns.az.VOICE.mp4",
    ]) {
      const response = await get(file)
      expect(response.status, file).toBe(404)
      expect(response.headers.get("cache-control"), file).toBe("no-store")
    }
  })

  it("offers no clip whose master is not published", () => {
    for (const slug of DEMO_PUBLIC_CLIP_SLUGS) {
      for (const suffix of ["VOICE.mp4", "poster.jpg"]) {
        expect(MASTERS.has(`${slug}.az.${suffix}`), `${slug}.az.${suffix}`).toBe(true)
      }
    }
  })

  it("puts the version into every URL, so a re-filmed clip reaches returning visitors", () => {
    expect(demoPublicClipUrl("demo-inbox", "video")).toBe(`/api/v1/public/demo-clips/demo-inbox.az.VOICE.mp4?v=${DEMO_PUBLIC_CLIPS_VERSION}`)
    expect(demoPublicClipUrl("demo-inbox", "poster")).toBe(`/api/v1/public/demo-clips/demo-inbox.az.poster.jpg?v=${DEMO_PUBLIC_CLIPS_VERSION}`)
  })
})
