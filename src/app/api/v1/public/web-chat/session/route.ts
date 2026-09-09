import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { randomBytes } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { runWithTenant, runWithRlsBypass } from "@/lib/rls-context"
import { buildWidgetCorsHeaders, isOriginAllowed } from "@/lib/widget-cors"
import { checkRateLimit } from "@/lib/rate-limit"
import { clientIp } from "@/lib/request-ip"
import { parsePreChatForm, validatePreChatSubmission } from "@/lib/web-chat-prechat"
import { matchOrCreateWebChatContact } from "@/lib/web-chat-contact"

export async function OPTIONS(req: NextRequest) {
  // Preflight: echo origin if whitelisted, otherwise deny
  const origin = req.headers.get("origin")
  return new NextResponse(null, { status: 204, headers: await buildWidgetCorsHeaders(req, origin) })
}

const schema = z.object({
  key: z.string().min(1),
  visitorName: z.string().max(200).optional(),
  // trim BEFORE .email(): mobile autocomplete pads addresses, and an untrimmed
  // "john@gmail.com " would 400 here before pre-chat validation ever runs.
  visitorEmail: z.string().trim().email().max(254).optional().or(z.literal("")),
  visitorPhone: z.string().max(50).optional(),
  pageUrl: z.string().max(2000).optional(),
})

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")
  const headers = await buildWidgetCorsHeaders(req, origin)

  // Keyed on clientIp(), not the raw XFF element the caller controls: this POST
  // creates a WebChatSession row and can create a Contact, so a per-request
  // bucket would leave it with no per-caller ceiling.
  const ip = clientIp(req)
  if (!checkRateLimit(`wc-session:${ip}`, { maxRequests: 5, windowMs: 60000 })) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers })
  }

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400, headers })
  }

  // RLS phase 1 — org resolution: publicKey is a cross-tenant external
  // identifier, so the lookup runs bypass-scoped (resolution only).
  const widget = await runWithRlsBypass(() =>
    prisma.webChatWidget.findUnique({ where: { publicKey: parsed.data.key } })
  )
  if (!widget || !widget.enabled) {
    return NextResponse.json({ error: "Widget not available" }, { status: 404, headers })
  }
  if (!isOriginAllowed(origin, widget.allowedOrigins)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers })
  }

  // Pre-chat form: server-side required-field enforcement + stripping of values
  // for fields the org disabled — BEFORE any DB write. Legacy widgets
  // (preChatForm NULL) parse to the default (all optional) = old behavior.
  // Master onboarding toggle OFF (uiOptions.onboardingEnabled === false) = the org chose
  // one-click anonymous starts — required-field enforcement must not deadlock those.
  const ui = widget.uiOptions && typeof widget.uiOptions === "object" && !Array.isArray(widget.uiOptions)
    ? (widget.uiOptions as Record<string, unknown>)
    : {}
  const onboardingEnabled = ui.onboardingEnabled !== false
  const preChatForm = parsePreChatForm(widget.preChatForm)
  const validated = validatePreChatSubmission(preChatForm, {
    visitorName: onboardingEnabled ? parsed.data.visitorName : undefined,
    visitorEmail: onboardingEnabled ? parsed.data.visitorEmail : undefined,
    visitorPhone: onboardingEnabled ? parsed.data.visitorPhone : undefined,
  })
  if (onboardingEnabled && !validated.ok) {
    return NextResponse.json(
      { error: "missing_required_fields", fields: validated.missing },
      { status: 400, headers },
    )
  }
  // Reaching here with !validated.ok means onboarding is OFF → anonymous session by design.
  const submission = validated.ok
    ? validated
    : { ok: true as const, values: { visitorName: null, visitorEmail: null, visitorPhone: null } }

  // RLS phase 2 — contact match + session/message creation run tenant-scoped.
  return await runWithTenant(widget.organizationId, async () => {
  const ipAddress = ip === "unknown" ? null : ip
  const userAgent = req.headers.get("user-agent") || null

  // Link or CREATE the CRM contact at session start (email match first, then
  // phone — the same shared policy escalation uses). Previously contacts were
  // only linked by email and created at ticket escalation.
  // Contact CREATION from this public endpoint is additionally capped per
  // widget (the per-IP limiter above is spoofable via X-Forwarded-For): when
  // the cap is hit the session still starts and the contact gets created
  // later at ticket escalation, exactly like before this feature.
  const hasIdentity = Boolean(submission.values.visitorEmail || submission.values.visitorPhone)
  const allowContactCreate =
    hasIdentity && checkRateLimit(`wc-contact-create:${widget.id}`, { maxRequests: 30, windowMs: 60000 })
  const matched = hasIdentity
    ? await matchOrCreateWebChatContact(
        widget.organizationId,
        {
          name: submission.values.visitorName,
          email: submission.values.visitorEmail,
          phone: submission.values.visitorPhone,
        },
        { createIfMissing: allowContactCreate },
      )
    : null

  // F-35: the session id IS the credential — messages, typing and upload all
  // accept it alone, from anyone, over an anonymous endpoint. `@default(cuid())`
  // is the wrong generator for that job: a cuid is semi-sequential, shares a
  // per-process fingerprint, and its own authors state it is not for security.
  // Supplying the id explicitly from a CSPRNG keeps the column, the widget and
  // every existing session untouched while new ones stop being guessable.
  const sessionId = randomBytes(24).toString("base64url")

  const session = await prisma.webChatSession.create({
    data: {
      id: sessionId,
      organizationId: widget.organizationId,
      visitorName: submission.values.visitorName,
      visitorEmail: submission.values.visitorEmail,
      visitorPhone: submission.values.visitorPhone,
      contactId: matched?.contactId ?? null,
      pageUrl: parsed.data.pageUrl || null,
      userAgent,
      ipAddress,
    },
  })

  const greeting = widget.greeting || "Hi! How can we help?"
  await prisma.webChatMessage.create({
    data: {
      organizationId: widget.organizationId,
      sessionId: session.id,
      fromRole: "bot",
      text: greeting,
    },
  })

  return NextResponse.json(
    { success: true, data: { sessionId: session.id, greeting } },
    { headers },
  )
  }) // end runWithTenant (tenant-scoped handler body)
}
