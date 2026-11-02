import { NextResponse } from "next/server"
import { latestFieldAppRelease } from "@/lib/mtm/field-app-release"

// What the field app asks when it opens: is there a newer build than mine?
// Public, like /api/v1/ping — the phone may not be signed in yet, and nothing
// here is tenant data: a version number, a date and the download address.
//
// `storeUrl` stays null until the app is on Google Play. Then set
// FIELD_APP_STORE_URL and the app sends people to the store instead: an app
// installed from Play must not update itself any other way (Play policy).

export const dynamic = "force-dynamic"

export async function GET() {
  const release = await latestFieldAppRelease()
  if (!release) {
    return NextResponse.json(
      { error: "No build is available right now", code: "FIELD_APP_RELEASE_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://app.leaddrivecrm.org"
  return NextResponse.json(
    {
      versionName: release.versionName,
      versionCode: release.versionCode,
      publishedAt: release.publishedAt,
      downloadUrl: `${base}/field/download`,
      pageUrl: `${base}/field`,
      storeUrl: process.env.FIELD_APP_STORE_URL?.trim() || null,
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  )
}
