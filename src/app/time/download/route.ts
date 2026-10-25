import { NextResponse } from "next/server"
import { latestTimeAppRelease, TIME_APP_ORIGIN } from "@/lib/mtm/time-app-release"

export const dynamic = "force-dynamic"

export async function GET() {
  const release = latestTimeAppRelease()
  if (!release) {
    return NextResponse.json(
      { error: "No accepted Time release is available", code: "TIME_APP_RELEASE_UNAVAILABLE", pageUrl: `${TIME_APP_ORIGIN}/time` },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
  const response = NextResponse.redirect(release.apkUrl, 302)
  response.headers.set("Cache-Control", "no-store")
  return response
}
