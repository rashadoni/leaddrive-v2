import { NextResponse } from "next/server"
import { latestTimeAppRelease, timeAppStoreUrl, TIME_APP_CHANNEL, TIME_APP_ORIGIN, TIME_APP_PACKAGE } from "@/lib/mtm/time-app-release"

export const dynamic = "force-dynamic"

export async function GET() {
  const release = latestTimeAppRelease()
  if (!release) {
    return NextResponse.json(
      { error: "No accepted Time release is available", code: "TIME_APP_RELEASE_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }
  return NextResponse.json(
    {
      packageName: TIME_APP_PACKAGE,
      channel: TIME_APP_CHANNEL,
      versionName: release.versionName,
      versionCode: release.versionCode,
      publishedAt: release.publishedAt,
      signingCertificateSha256: release.signingCertificateSha256,
      apkSha256: release.apkSha256,
      downloadUrl: `${TIME_APP_ORIGIN}/time/download`,
      pageUrl: `${TIME_APP_ORIGIN}/time`,
      storeUrl: timeAppStoreUrl(),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
