import { NextRequest, NextResponse } from "next/server"
import { readInboxAttachment } from "@/lib/inbox-attachment"
import { readOutboundMediaToken } from "@/lib/inbox/outbound-media-link"
import { runWithTenant } from "@/lib/rls-context"

/**
 * Where Meta fetches a file an agent is sending to a customer on Instagram or Messenger.
 *
 * No session: the token in the path is the whole permission — one file, one organisation, minutes
 * (lib/inbox/outbound-media-link). Anything wrong with it answers 404, the same as a file that is
 * not there, so the route says nothing about what exists.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string; name: string }> }) {
  const { token, name } = await ctx.params
  const grant = readOutboundMediaToken(token)
  if (!grant || grant.fileName !== name) return new NextResponse(null, { status: 404 })

  const file = await runWithTenant(grant.organizationId, () =>
    readInboxAttachment(grant.uploadUrl, grant.organizationId),
  ).catch(() => null)
  if (!file) return new NextResponse(null, { status: 404 })

  return new NextResponse(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.buffer.byteLength),
      "Content-Disposition": `inline; filename="${file.filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  })
}
