import type { NextRequest } from "next/server"
import { expireDemoGrantIfNeeded } from "@/lib/demo-center/access"
import { demoGrantManifest } from "@/lib/demo-center/grant-manifest"
import { demoSessionCookieName, secureHashMatches } from "@/lib/demo-center/security"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { prisma } from "@/lib/prisma"
import type { DemoJourneyManifest } from "@/lib/demo-center/journey"

/**
 * The grant behind a call to the demo's assistant, checked the one way every
 * assistant route checks it: the link exists, has not run out, is in a live
 * session, and that session is THIS browser's (the httpOnly cookie the start
 * route set). Then the story it walks, and whether that story has the
 * assistant at all. The open demo and the admin preview have no such session,
 * so nothing here can answer them.
 *
 * Call it inside `runWithRlsBypass`: the demo tables are control-plane rows
 * under FORCE RLS, and a read outside the bypass finds no grant.
 */
export async function loadActiveDemoGrant(request: NextRequest, token: string, now: Date) {
  const grant = await prisma.demoGrant.findUnique({
    where: { tokenHash: hashOneTimeToken(token) },
    include: { request: { select: { name: true, company: true, jobTitle: true, email: true, phone: true, source: true } } },
  })
  if (!grant) return { ok: false as const, status: 404 as const }
  if (await expireDemoGrantIfNeeded(grant, now)) return { ok: false as const, status: 410 as const }
  if (grant.status !== "ACTIVE") return { ok: false as const, status: 401 as const }
  if (!secureHashMatches(request.cookies.get(demoSessionCookieName(token))?.value, grant.sessionHash)) {
    return { ok: false as const, status: 401 as const }
  }
  // The grant's own story: with the live call when it has one, so a question
  // asked on the call step is answered about the call step.
  const manifest: DemoJourneyManifest = demoGrantManifest(grant)
  if (!manifest.capabilities.assistant) return { ok: false as const, status: 403 as const }
  return { ok: true as const, grant, manifest }
}

export type ActiveDemoGrant = Extract<Awaited<ReturnType<typeof loadActiveDemoGrant>>, { ok: true }>["grant"]
