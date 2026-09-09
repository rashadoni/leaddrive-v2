import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass, runWithTenant } from "@/lib/rls-context"
import {
  confirmTicketClosureByHash,
  getTicketClosureRequestByHash,
  hashTicketClosureToken,
} from "@/lib/ticketing/closure-requests"

const actionSchema = z.object({
  action: z.enum(["confirm", "reject"]).default("confirm"),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const tokenHash = hashTicketClosureToken(token)
  const orgId = await resolveClosureRequestOrg(tokenHash)
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return runWithTenant(orgId, async () => {
    const request = await getTicketClosureRequestByHash(orgId, tokenHash)
    if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({
      success: true,
      data: {
        id: request.id,
        status: request.status,
        requestedAt: request.requestedAt,
        dueAt: request.dueAt,
        confirmedAt: request.confirmedAt,
        rejectedAt: request.rejectedAt,
        expiredAt: request.expiredAt,
        ticket: request.ticket,
      },
    })
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const tokenHash = hashTicketClosureToken(token)
  const orgId = await resolveClosureRequestOrg(tokenHash)
  if (!orgId) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const parsed = actionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  return runWithTenant(orgId, async () => {
    const result = await confirmTicketClosureByHash({
      orgId,
      tokenHash,
      action: parsed.data.action,
    })
    if (result.status === "not_found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true, data: result })
  })
}

async function resolveClosureRequestOrg(tokenHash: string): Promise<string | null> {
  const request = await runWithRlsBypass(() =>
    prisma.ticketClosureRequest.findUnique({
      where: { tokenHash },
      select: { organizationId: true },
    }),
  )
  return request?.organizationId || null
}
