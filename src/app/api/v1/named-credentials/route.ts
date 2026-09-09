/**
 * Named-credential registry — N17 Phase 5 slice 1.
 *
 *   POST /api/v1/named-credentials  — create + encrypt secret
 *   GET  /api/v1/named-credentials  — list (NEVER returns plaintext / ciphertext)
 *
 * The plaintext secret only ever exists in memory for the duration
 * of the POST request; after `encryptSecret` it's never readable
 * again unless the master vault key is present.
 *
 * Listing endpoint scrubs `secret*` columns — the UI never displays
 * the secret; users see only metadata + test status. Slice 2 adds
 * a rotate endpoint (re-encrypt under new plaintext) + a usage-log
 * surface.
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { encryptSecret } from "@/lib/credentials/vault"
import { validateOutboundWebhookUrl } from "@/lib/integrations/webhook-url-guard"

const authConfigSchema = z.record(z.string(), z.unknown()).optional()

const createSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z_][a-z0-9_]*$/i, "name must be a valid identifier"),
    description: z.string().max(2000).optional(),
    baseUrl: z.string().url(),
    authType: z.enum(["bearer", "basic", "api_key_header", "none"]),
    authConfig: authConfigSchema,
    /** Plaintext secret — required for auth ≠ none; never persisted. */
    secret: z.string().min(1).max(8000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.authType === "none") {
      if (data.secret) {
        ctx.addIssue({
          code: "custom",
          message: "authType=none must not include `secret`",
          path: ["secret"],
        })
      }
    } else if (!data.secret) {
      ctx.addIssue({
        code: "custom",
        message: `authType=${data.authType} requires \`secret\``,
        path: ["secret"],
      })
    }
    if (data.authType === "api_key_header") {
      const headerName = data.authConfig?.headerName
      if (typeof headerName !== "string" || headerName.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "api_key_header requires authConfig.headerName",
          path: ["authConfig", "headerName"],
        })
      }
    }
    // Validate basic-auth secret at create time so a malformed
    // "user:pass" (missing colon) is rejected immediately instead of
    // failing later at credential-test or first sandbox use.
    // TODO(slice 2): when the update-credential endpoint lands, share
    // this check via an extracted Zod refine so PATCH/PUT can't
    // bypass the basic-auth validation.
    if (data.authType === "basic" && data.secret && !data.secret.includes(":")) {
      ctx.addIssue({
        code: "custom",
        message: 'basic auth secret must be in "user:pass" form',
        path: ["secret"],
      })
    }
    if (!data.baseUrl.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        message: "baseUrl must use https:// (slice 1 hardening)",
        path: ["baseUrl"],
      })
    }
  })

async function readBody(req: NextRequest): Promise<unknown | NextResponse> {
  let raw: string
  try {
    raw = await req.text()
  } catch {
    return NextResponse.json({ error: "Could not read request body" }, { status: 400 })
  }
  if (raw.trim().length === 0) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
  }
}

export const POST = withRlsAuth("settings", "write", async (req: NextRequest, auth) => {
  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  let normalizedBaseUrl: string
  try {
    const target = await validateOutboundWebhookUrl(parsed.data.baseUrl, {
      allowHttp: false,
    })
    normalizedBaseUrl = target.url.toString()
  } catch {
    return NextResponse.json(
      { error: "baseUrl must be a resolvable public HTTPS URL" },
      { status: 400 },
    )
  }

  const encrypted =
    parsed.data.authType === "none"
      ? null
      : encryptSecret({
          organizationId: auth.orgId,
          name: parsed.data.name,
          plaintext: parsed.data.secret!,
        })

  let created
  try {
    created = await prisma.namedCredential.create({
      data: {
        organizationId: auth.orgId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        baseUrl: normalizedBaseUrl,
        authType: parsed.data.authType,
        authConfig: parsed.data.authConfig
          ? (parsed.data.authConfig as Prisma.InputJsonValue)
          : undefined,
        secretCiphertext: encrypted?.ciphertext ?? null,
        secretIv: encrypted?.iv ?? null,
        secretTag: encrypted?.tag ?? null,
        secretAlg: encrypted?.alg ?? null,
        createdBy: auth.userId,
      },
      select: {
        id: true,
        name: true,
        description: true,
        baseUrl: true,
        authType: true,
        authConfig: true,
        testStatus: true,
        isActive: true,
        createdAt: true,
      },
    })
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `A credential with name "${parsed.data.name}" already exists in this tenant` },
        { status: 409 }
      )
    }
    throw e
  }

  return NextResponse.json({ credential: created }, { status: 201 })
})

export const GET = withRlsAuth("settings", "read", async (_req: NextRequest, auth) => {
  // CRITICAL: never select secretCiphertext / secretIv / secretTag —
  // even an admin user reading the list shouldn't get the ciphertext,
  // since that'd let them try offline brute-force without leaving an
  // audit-log trace. Test endpoint is the only sanctioned use.
  const credentials = await prisma.namedCredential.findMany({
    where: { organizationId: auth.orgId },
    select: {
      id: true,
      name: true,
      description: true,
      baseUrl: true,
      authType: true,
      authConfig: true,
      testStatus: true,
      testStatusMessage: true,
      testedAt: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  })

  return NextResponse.json({ credentials })
})
