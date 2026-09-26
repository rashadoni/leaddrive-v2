/**
 * The open demo streams the clips filmed on the invented demo stand to a
 * visitor with no session (owner decision 2026-09-22), and nothing else.
 */
import { statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import { GET as getOpenClip } from "@/app/api/v1/public/demo-clips/[file]/route"
import { DEMO_PUBLIC_CLIP_SLUGS, DEMO_PUBLIC_CLIPS_VERSION, demoPublicClipUrl } from "@/lib/demo-center/journey"

function get(file: string, headers: Record<string, string> = {}) {
  return getOpenClip(
    new NextRequest(new URL(`/api/v1/public/demo-clips/${encodeURIComponent(file)}`, "http://localhost:3000"), { headers }),
    { params: Promise.resolve({ file }) },
  )
}

describe("the open demo's public clips", () => {
  it("serves each stand clip and its poster to anyone, cacheable", async () => {
    for (const slug of DEMO_PUBLIC_CLIP_SLUGS) {
      for (const [suffix, type] of [["VOICE.mp4", "video/mp4"], ["poster.jpg", "image/jpeg"]] as const) {
        const file = `${slug}.az.${suffix}`
        const response = await get(file)
        expect(response.status, file).toBe(200)
        expect(response.headers.get("content-type"), file).toBe(type)
        expect(response.headers.get("cache-control"), file).toBe("public, max-age=86400")
        expect(Number(response.headers.get("content-length")), file).toBe(statSync(path.join(process.cwd(), "video/player", file)).size)
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
      "deal-detail.az.VOICE.mp4", // played by the story, but filmed on LeadDrive Inc.'s test records
      "quotes.az.poster.jpg",
      "leads.az.VOICE.mp4",
      "demo-campaigns.en.VOICE.mp4",
      "demo-campaigns.az.srt",
      "..%2Fdemo-campaigns.az.VOICE.mp4",
    ]) {
      const response = await get(file)
      expect(response.status, file).toBe(404)
      expect(response.headers.get("cache-control"), file).toBe("no-store")
    }
  })

  it("puts the version into every URL, so a re-filmed clip reaches returning visitors", () => {
    expect(demoPublicClipUrl("demo-inbox", "video")).toBe(`/api/v1/public/demo-clips/demo-inbox.az.VOICE.mp4?v=${DEMO_PUBLIC_CLIPS_VERSION}`)
    expect(demoPublicClipUrl("demo-inbox", "poster")).toBe(`/api/v1/public/demo-clips/demo-inbox.az.poster.jpg?v=${DEMO_PUBLIC_CLIPS_VERSION}`)
  })
})
