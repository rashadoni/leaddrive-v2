import { NextRequest, NextResponse } from "next/server"
import { getHelpVideoForSlug } from "@/content/help/video-assets"
import { DEMO_PUBLIC_CLIP_SLUGS, demoJourneyClipSlugs } from "@/lib/demo-center/journey"
import { parseHelpVideoFile, serveHelpVideoFile } from "@/lib/help-videos/serve"

/**
 * The open demo's clips, for a visitor who holds no session and no grant.
 *
 * Narrow on purpose (src/lib/demo-center/journey/public-clips.ts):
 *   - only the clips filmed on the invented demo stand, never the rest of
 *     the help library, whose clips show real organisations' records;
 *   - only a slug an approved scenario really plays, and only Azerbaijani;
 *   - only a clip the help pipeline itself would serve, which keeps the
 *     local-TTS voiceover ban in force here too.
 *
 * Nothing about the visitor is read, so the answer may be cached publicly:
 * the same four files for everyone, at a versioned URL.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const parsed = parseHelpVideoFile(file)
  if (!parsed || parsed.locale !== "az") return notFound()
  if (!DEMO_PUBLIC_CLIP_SLUGS.has(parsed.slug) || !demoJourneyClipSlugs().has(parsed.slug)) return notFound()
  if (!getHelpVideoForSlug(parsed.slug, "az")) return notFound()

  return serveHelpVideoFile(file, request.headers.get("range"), {
    "Cache-Control": "public, max-age=86400",
    "X-Robots-Tag": "noindex, nofollow",
  })
}

function notFound() {
  return NextResponse.json({ success: false, error: "Klip tapılmadı" }, { status: 404, headers: { "Cache-Control": "no-store" } })
}
