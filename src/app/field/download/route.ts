import { NextResponse } from "next/server"
import { latestFieldAppRelease } from "@/lib/mtm/field-app-release"

// The one address given to clients and opened by the app's «Update» button:
// always the newest build of main, never a working-branch build
// (src/lib/mtm/field-app-release.ts). Nothing is stored here; the APK is
// served by GitHub, signed with the release key the installed app carries,
// so it installs over it and the agent keeps unsent visits.

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const release = await latestFieldAppRelease()
  const target = release ? release.apkUrl : new URL("/field", req.url).toString()
  const response = NextResponse.redirect(target, 302)
  response.headers.set("Cache-Control", "no-store")
  return response
}
