import { NextRequest } from "next/server"
import { requireAuth } from "@/lib/api-auth"
import { HELP_VIDEO_FILE_PATTERN, serveHelpVideoFile } from "@/lib/help-videos/serve"

export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params

  // Checked before authentication so a bad name is a plain 404 either way.
  if (!HELP_VIDEO_FILE_PATTERN.test(file)) {
    return new Response("Not found", { status: 404 })
  }

  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  return serveHelpVideoFile(file, req.headers.get("range"))
}
