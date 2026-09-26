import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { createRestActorContext } from "@/lib/crm-commands/actor-context"
import { CrmCommandError } from "@/lib/crm-commands/errors"
import { convertLeadToDealCommand } from "@/lib/crm-commands/lead/convert-lead-to-deal"

export const POST = withRlsAuth(
  "leads",
  "write",
  async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    try {
      const result = await convertLeadToDealCommand(createRestActorContext({
        organizationId: auth.orgId,
        userId: auth.userId,
        role: auth.role,
        requestId: req.headers.get("x-request-id"),
      }), id, body)
      return NextResponse.json({ success: true, data: result }, { status: 201 })
    } catch (error) {
      if (error instanceof CrmCommandError) {
        if (error.status === 403) {
          return NextResponse.json(
            { error: "Forbidden", message: error.message, code: error.code },
            { status: error.status },
          )
        }
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: error.status },
        )
      }
      console.error("[leads/convert]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  },
)
