import { NextResponse } from "next/server"
import { BUILT_AT, DEPLOY_SHA } from "@/generated/build-sha"

// What is actually running in production, answerable over HTTPS.
//
// Until now the only way to tell was an SSH session plus a grep of the compiled
// bundle: `git log` inside /opt/leaddrive-v2 reports the checkout, not the
// deployed artifact, and has already sent investigations down the wrong path.
//
// The values come from a constant compiled into the bundle, never from a file
// on disk. A marker file would only prove which files were unpacked — the
// process serving this request could be older than them and would still read
// and report the new value. A constant cannot lie about the code it lives in.
//
// Public, like /api/v1/ping. The full immutable artifact SHA is deliberately
// non-secret release metadata needed to prove what code serves traffic; it
// grants no access to the private repository. The short SHA remains for
// backwards compatibility, while automation must compare artifactSha. Nothing
// else is exposed: no paths, dependency versions, or environment.

export const dynamic = "force-dynamic"

export function GET() {
  const artifactSha = /^[0-9a-f]{40}$/.test(DEPLOY_SHA) ? DEPLOY_SHA : null
  const sha = artifactSha?.slice(0, 12) ?? null

  return NextResponse.json(
    { sha, artifactSha, builtAt: BUILT_AT || null },
    { headers: { "Cache-Control": "no-store" } },
  )
}
