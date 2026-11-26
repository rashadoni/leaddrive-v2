import { NextResponse } from "next/server"
import { FIELD_APP_PLAY_RELEASE, FIELD_APP_STORE_URL, latestFieldAppRelease } from "@/lib/mtm/field-app-release"

// What the field app asks when it opens: is there a newer build than mine?
// Public, like /api/v1/ping — the phone may not be signed in yet, and nothing
// here is tenant data: a version number, a date and the download address.
//
// Once the app is in Google Play (`FIELD_APP_PLAY_RELEASE`), the answer is the
// store's version with the store address, and the app sends people there: an
// app installed from Play must not update itself any other way (Play policy).
// Without it, the newest build of main and the APK link, as before.

export const dynamic = "force-dynamic"

export async function GET() {
  const play = FIELD_APP_PLAY_RELEASE
  const release = play ? null : await latestFieldAppRelease()
  const offered = play ?? release
  if (!offered) {
    return NextResponse.json(
      { error: "No build is available right now", code: "FIELD_APP_RELEASE_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://app.leaddrivecrm.org"
  return NextResponse.json(
    {
      versionName: offered.versionName,
      versionCode: offered.versionCode,
      ...(release ? { publishedAt: release.publishedAt } : {}),
      downloadUrl: `${base}/field/download`,
      pageUrl: `${base}/field`,
      storeUrl: play ? FIELD_APP_STORE_URL : null,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  )
}
