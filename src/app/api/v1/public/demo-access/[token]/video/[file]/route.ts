import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { expireDemoGrantIfNeeded, noStoreHeaders, validRawDemoToken } from "@/lib/demo-center/access"
import { demoSessionCookieName, secureHashMatches } from "@/lib/demo-center/security"
import { demoJourneyClipSlugs } from "@/lib/demo-center/journey"
import { getHelpVideoForSlug } from "@/content/help/video-assets"
import { parseHelpVideoFile, serveHelpVideoFile } from "@/lib/help-videos/serve"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * Guide clips for a live demo session.
 *
 * The help-video pipeline serves its files from `/api/help-videos/[file]`,
 * which calls `requireAuth` — a prospect holds a capability session and no
 * tenant session, so that route answers 401 and the player sits broken.
 * This route is the same bytes behind the demo's own gate instead.
 *
 * Narrower than the tenant route on purpose:
 *   - only a slug some approved scenario actually plays;
 *   - only Azerbaijani, the language every issued scenario is written in;
 *   - only a clip the help pipeline itself will serve, which keeps the
 *     repository's local-TTS voiceover ban in force here too
 *     (`getHelpVideoForSlug` returns null for a blocked or missing clip);
 *   - only while the grant is ACTIVE and this browser holds the session.
 *
 * `Cache-Control: private` keeps the token-bearing URL out of shared caches
 * while still letting the viewer's own browser cache and seek.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; file: string }> },
) {
  const { token, file } = await params
  if (!validRawDemoToken(token)) return notFound()

  const parsed = parseHelpVideoFile(file)
  if (!parsed || parsed.locale !== "az") return notFound()
  if (!demoJourneyClipSlugs().has(parsed.slug)) return notFound()
  if (!getHelpVideoForSlug(parsed.slug, "az")) return notFound()

  const allowed = await runWithRlsBypass(async () => {
    const grant = await prisma.demoGrant.findUnique({ where: { tokenHash: hashOneTimeToken(token) } })
    if (!grant) return false
    if (await expireDemoGrantIfNeeded(grant, new Date())) return false
    if (grant.status !== "ACTIVE") return false
    return secureHashMatches(request.cookies.get(demoSessionCookieName(token))?.value, grant.sessionHash)
  })
  if (!allowed) return notFound()

  return serveHelpVideoFile(file, request.headers.get("range"), {
    "Cache-Control": "private, max-age=3600",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  })
}

/** Nothing distinguishes "no such grant" from "no such clip": both are 404. */
function notFound() {
  return NextResponse.json({ success: false, error: "Demo tapılmadı" }, { status: 404, headers: noStoreHeaders() })
}
