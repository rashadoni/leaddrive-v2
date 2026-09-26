import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { COMPANY_EMAIL } from "@/lib/constants"
import { autoIssueDemoGrant } from "@/lib/demo-center/auto-issue"
import { getDemoModules } from "@/lib/demo-center/catalog"
import { sendDemoRequestNotification } from "@/lib/demo-center/email"
import { emailDomain } from "@/lib/demo-center/security"
import { demoRequestSchema } from "@/lib/demo-center/validation"
import { runWithRlsBypass } from "@/lib/rls-context"

/**
 * The marketing site (leaddrivecrm.org, a separate Cloudflare worker) posts
 * here cross-origin with a JSON body, so the browser asks first with a
 * preflight. Without an answer to it the POST was never sent: from the site's
 * switch to this endpoint (2026-09-23) every demo request ended in «Göndərmək
 * alınmadı» and no row, no e-mail, no log line. Only the marketing origins are
 * answered — the form is not an API for anyone else's page.
 */
const DEMO_REQUEST_ORIGINS = ["https://leaddrivecrm.org", "https://www.leaddrivecrm.org"] as const

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin")
  const headers: Record<string, string> = { Vary: "Origin" }
  if (origin && (DEMO_REQUEST_ORIGINS as readonly string[]).includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin
  }
  return headers
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders(request),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    },
  })
}

export async function POST(request: Request) {
  // Every answer carries the header, errors included: a 400 the site cannot
  // read would look to the prospect like the network failing, and a stored
  // request answered without it would be submitted twice.
  const cors = corsHeaders(request)
  const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: cors })

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ success: false, error: "Sorğu formatı düzgün deyil" }, 400)
  }

  const parsed = demoRequestSchema.safeParse(payload)
  if (!parsed.success) {
    return json(
      {
        success: false,
        error: parsed.error.issues[0]?.message || "Məlumatları yoxlayın",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      400,
    )
  }

  // Filled honeypots receive the same generic response without creating a row.
  if (parsed.data.website) {
    return json({ success: true, message: "Demo sorğusu qəbul edildi" }, 201)
  }

  const created = await runWithRlsBypass(() =>
    prisma.demoRequest.create({
      data: {
        name: parsed.data.name,
        company: parsed.data.company,
        jobTitle: parsed.data.jobTitle || null,
        email: parsed.data.email,
        emailNormalized: parsed.data.email,
        emailDomain: emailDomain(parsed.data.email),
        phone: parsed.data.phone || null,
        message: parsed.data.message || null,
        requestedModules: parsed.data.requestedModules,
        locale: parsed.data.locale,
        consentAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        company: true,
        jobTitle: true,
        email: true,
        emailNormalized: true,
        locale: true,
        phone: true,
        message: true,
        requestedModules: true,
      },
    }),
  ).catch((error) => {
    console.error("[demo-request] could not store the request", error)
    return null
  })

  if (!created) {
    return json({ success: false, error: "Sorğunu hazırda saxlaya bilmədik. Bir qədər sonra yenidən cəhd edin." }, 503)
  }

  const requestedModuleNames = getDemoModules(created.requestedModules).map((module) => module.title)
  // Persistence is the source of truth. A notification outage must not discard
  // a valid request or make the prospect resubmit their personal information.
  await sendDemoRequestNotification({
    to: COMPANY_EMAIL,
    requestId: created.id,
    name: created.name,
    company: created.company,
    email: created.email,
    phone: created.phone,
    jobTitle: created.jobTitle,
    message: created.message,
    requestedModuleNames,
  }).catch(() => undefined)

  // The invitation goes out by itself (src/lib/demo-center/auto-issue.ts), so
  // the form's «check your email» is true by the time it is read. A refusal
  // there is not the prospect's problem: the request is stored, the owner has
  // it in Demo Center, and the answer stays the same.
  const invitation = await autoIssueDemoGrant({ request: created }).catch((error) => {
    console.error("[demo-request] auto-issue threw", { requestId: created.id }, error)
    return "failed" as const
  })

  return json({ success: true, requestId: created.id, invitation, message: "Demo sorğusu qəbul edildi" }, 201)
}
