import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { COMPANY_EMAIL } from "@/lib/constants"
import { autoIssueDemoGrant } from "@/lib/demo-center/auto-issue"
import { requestedModuleNames } from "@/lib/demo-center/requested-modules"
import {
  DEMO_REQUEST_ALLOWED_HEADERS,
  DEMO_REQUEST_ALLOWED_METHODS,
  DEMO_REQUEST_PREFLIGHT_MAX_AGE_SECONDS,
  withDemoRequestCors,
} from "@/lib/demo-request-cors"
import { sendDemoRequestNotification } from "@/lib/demo-center/email"
import { verifyDemoFormSolution } from "@/lib/demo-center/form-challenge"
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
    return quietlyDropped(request)
  }

  // The bot check (src/lib/demo-center/form-challenge.ts). A person can end up
  // without a usable one — it did not load, the tab sat open for hours — and
  // is asked to send again. Everything else only a script produces, and gets
  // the honeypot's answer so it cannot tell which check stopped it.
  const verdict = verifyDemoFormSolution(parsed.data.challenge)
  if (verdict === "missing" || verdict === "expired") {
    return jsonResponse(
      request,
      { success: false, code: `challenge_${verdict}`, error: "Səhifəni yeniləyib sorğunu yenidən göndərin." },
      { status: 400 },
    )
  }
  if (verdict !== "ok") {
    console.warn("[demo-request] bot check refused", { verdict })
    return quietlyDropped(request)
  }
  const challengeSalt = (parsed.data.challenge as { salt: string }).salt

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
        formChallengeSalt: challengeSalt,
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
  ).catch((error: unknown) => {
    // A solved challenge already spent on another request: a replay.
    if ((error as { code?: string })?.code === "P2002") return "replayed" as const
    console.error("[demo-request] could not store the request", error)
    return null
  })

  if (created === "replayed") {
    console.warn("[demo-request] bot check refused", { verdict: "replayed" })
    return quietlyDropped(request)
  }

  if (!created) {
    return jsonResponse(
      request,
      { success: false, error: "Sorğunu hazırda saxlaya bilmədik. Bir qədər sonra yenidən cəhd edin." },
      { status: 503 },
    )
  }

  // The owner is not told yet: anyone can type any address into the form.
  // The link goes to that address (src/lib/demo-center/auto-issue.ts), and
  // his «Yeni demo sorğusu» leaves only when the prospect opens it and
  // confirms (src/lib/demo-center/email-confirmation.ts). A refusal here is
  // not the prospect's problem: the request is stored, it is in Demo Center,
  // and the answer stays the same.
  const invitation = await autoIssueDemoGrant({ request: created }).catch((error) => {
    console.error("[demo-request] auto-issue threw", { requestId: created.id }, error)
    return "failed" as const
  })

  // No link went out, so nobody can confirm: without this the request would
  // wait in Demo Center unseen. The owner hears about it now, marked as not
  // confirmed. A notification outage still must not cost a stored request.
  if (invitation === "failed" || invitation === "unavailable") {
    await sendDemoRequestNotification({
      to: COMPANY_EMAIL,
      confirmation: "link_not_sent",
      requestId: created.id,
      name: created.name,
      company: created.company,
      email: created.email,
      phone: created.phone,
      jobTitle: created.jobTitle,
      message: created.message,
      requestedModuleNames: requestedModuleNames(created.requestedModules),
    }).catch(() => undefined)
  }

  return jsonResponse(
    request,
    { success: true, requestId: created.id, invitation, message: "Demo sorğusu qəbul edildi" },
    { status: 201 },
  )
}

function quietlyDropped(request: Request) {
  return jsonResponse(request, { success: true, message: "Demo sorğusu qəbul edildi" }, { status: 201 })
}
