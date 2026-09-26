import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { COMPANY_EMAIL } from "@/lib/constants"
import { autoIssueDemoGrant } from "@/lib/demo-center/auto-issue"
import { getDemoModules } from "@/lib/demo-center/catalog"
import {
  DEMO_REQUEST_ALLOWED_HEADERS,
  DEMO_REQUEST_ALLOWED_METHODS,
  DEMO_REQUEST_PREFLIGHT_MAX_AGE_SECONDS,
  withDemoRequestCors,
} from "@/lib/demo-request-cors"
import { sendDemoRequestNotification } from "@/lib/demo-center/email"
import { emailDomain } from "@/lib/demo-center/security"
import { demoRequestSchema } from "@/lib/demo-center/validation"
import { runWithRlsBypass } from "@/lib/rls-context"

function jsonResponse(request: Request, body: unknown, init?: ResponseInit) {
  return withDemoRequestCors(request, NextResponse.json(body, init))
}

export function OPTIONS(request: Request) {
  return withDemoRequestCors(
    request,
    new NextResponse(null, {
      status: 204,
      headers: {
        Allow: DEMO_REQUEST_ALLOWED_METHODS,
        "Access-Control-Allow-Methods": DEMO_REQUEST_ALLOWED_METHODS,
        "Access-Control-Allow-Headers": DEMO_REQUEST_ALLOWED_HEADERS,
        "Access-Control-Max-Age": String(DEMO_REQUEST_PREFLIGHT_MAX_AGE_SECONDS),
      },
    }),
  )
}

export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return jsonResponse(request, { success: false, error: "Sorğu formatı düzgün deyil" }, { status: 400 })
  }

  const parsed = demoRequestSchema.safeParse(payload)
  if (!parsed.success) {
    return jsonResponse(
      request,
      {
        success: false,
        error: parsed.error.issues[0]?.message || "Məlumatları yoxlayın",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    )
  }

  // Filled honeypots receive the same generic response without creating a row.
  if (parsed.data.website) {
    return jsonResponse(request, { success: true, message: "Demo sorğusu qəbul edildi" }, { status: 201 })
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
  ).catch(() => null)

  if (!created) {
    return jsonResponse(
      request,
      { success: false, error: "Sorğunu hazırda saxlaya bilmədik. Bir qədər sonra yenidən cəhd edin." },
      { status: 503 },
    )
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
  const invitation = await autoIssueDemoGrant({ request: created }).catch(() => "failed" as const)

  return jsonResponse(
    request,
    { success: true, requestId: created.id, invitation, message: "Demo sorğusu qəbul edildi" },
    { status: 201 },
  )
}
