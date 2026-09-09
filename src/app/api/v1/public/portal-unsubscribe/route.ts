import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"

const schema = z.object({
  email: z.string().email(),
  reason: z.string().max(500).optional(),
})

// POST /api/v1/public/portal-unsubscribe
//   Also accepts GET/POST for List-Unsubscribe=One-Click (RFC 8058): mailers
//   expect a 200/202 without requiring interactive confirmation.
//   Writes a global opt-out (surveyId=null) to SurveyUnsubscribe for every
//   org that has a contact with this email — covers the case where the same
//   address is known to multiple tenants.
export async function POST(req: NextRequest) {
  let email = ""
  let reason: string | undefined

  const ct = req.headers.get("content-type") || ""
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null)
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }
    email = parsed.data.email.toLowerCase().trim()
    reason = parsed.data.reason
  } else {
    // Gmail's List-Unsubscribe=One-Click posts form-urlencoded with no body.
    // Fall back to reading email from the query string.
    const form = await req.formData().catch(() => null)
    const formEmail = form?.get("email") as string | null
    const qEmail = new URL(req.url).searchParams.get("email")
    email = (formEmail || qEmail || "").toLowerCase().trim()
  }

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 })
  }

  try {
    // RLS phase 1 — this endpoint is cross-tenant BY DESIGN (one email may be
    // known to several orgs); the email→contacts resolution runs bypass-scoped.
    const contacts = await runWithRlsBypass(() =>
      prisma.contact.findMany({
        where: { email },
        select: { id: true, organizationId: true },
      })
    )
    // Always return success (prevents email enumeration) — even if contact not found
    // we just don't write anything and pretend it worked.
    // RLS phase 2 — each org's opt-out check+write runs under THAT org's tenant scope.
    for (const c of contacts) {
      await runWithTenant(c.organizationId, async () => {
        const existing = await prisma.surveyUnsubscribe.findFirst({
          where: { organizationId: c.organizationId, email, surveyId: null },
        })
        if (!existing) {
          await prisma.surveyUnsubscribe.create({
            data: {
              organizationId: c.organizationId,
              email,
              surveyId: null,
              reason: reason || "portal_unsubscribe",
            },
          })
        }
      })
    }

    return NextResponse.json({
      success: true,
      message: "Готово. Мы перестанем присылать маркетинговые сообщения на этот адрес.",
    })
  } catch (e) {
    console.error("[portal-unsubscribe] error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// GET handler just returns 200 so any health probes or legacy links don't 404.
export async function GET() {
  return NextResponse.json({
    success: true,
    message: "Use POST to unsubscribe or open /portal/unsubscribe?email=… in a browser.",
  })
}
