/**
 * Apex-equivalent code-module registry — N3 Phase 5 slice 1.
 *
 *   POST /api/v1/code-modules  — create a module
 *   GET  /api/v1/code-modules  — list tenant modules
 *
 * Slice 1 only supports `triggerType: "manual"` (executed via
 * /[id]/execute). Slice 2 wires record-event + cron triggers.
 */
import crypto from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { validateCodeModuleSource } from "@/lib/apex/source-guard"
import { ABSOLUTE_MAX_LOG_LINES, ABSOLUTE_TIMEOUT_MS } from "@/lib/apex/types"

/**
 * Source-size cap. Slice 1 conservative — comparable to Salesforce
 * Apex's 1 MB limit but tighter because:
 *   1. The process-local compile cache holds up to 200 vm.Script
 *      objects; at ~2-3× source size each, 200KB × 200 = ~80 MB
 *      ceiling per worker, leaving headroom for multi-tenant.
 *   2. Each request body adds to Next.js's edge memory footprint.
 *   3. Slice 2 introduces npm-import allowlist + line-count limits;
 *      tighter source cap pairs with declarative module limits.
 *
 * Lift this in slice 2 once isolated-vm replaces node:vm (V8 isolates
 * have their own memory cap, so the per-Script cost stops being the
 * binding constraint).
 */
const MAX_SOURCE_BYTES = 200_000

const createSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z_][a-z0-9_]*$/i, "name must be a valid identifier"),
  description: z.string().max(2000).optional(),
  source: z.string().min(1).max(MAX_SOURCE_BYTES),
  // Slice 1 only accepts "manual"; the schema CHECK constraint also
  // gates the other values, but Zod gives a friendlier 400.
  triggerType: z.literal("manual").default("manual"),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  timeoutMs: z.number().int().min(1).max(ABSOLUTE_TIMEOUT_MS).optional(),
  maxLogLines: z.number().int().min(1).max(ABSOLUTE_MAX_LOG_LINES).optional(),
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
  // settings:write — code modules are admin-tier configuration that
  // can read+write CRM data through the sandbox, so the gate stays
  // narrow. Slice 2 may split into a separate "code" module + role.

  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const sourceGuard = validateCodeModuleSource(parsed.data.source)
  if (!sourceGuard.ok) {
    return NextResponse.json(
      { error: sourceGuard.reason ?? "Code module source rejected" },
      { status: 400 }
    )
  }

  const sourceHash = crypto.createHash("sha256").update(parsed.data.source).digest("hex")

  let created
  try {
    created = await prisma.codeModule.create({
      data: {
        organizationId: auth.orgId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        source: parsed.data.source,
        sourceHash,
        triggerType: parsed.data.triggerType,
        triggerConfig: parsed.data.triggerConfig
          ? (parsed.data.triggerConfig as Prisma.InputJsonValue)
          : undefined,
        timeoutMs: parsed.data.timeoutMs ?? 3000,
        maxLogLines: parsed.data.maxLogLines ?? 500,
        createdBy: auth.userId,
      },
      select: {
        id: true,
        name: true,
        description: true,
        triggerType: true,
        isActive: true,
        timeoutMs: true,
        maxLogLines: true,
        sourceHash: true,
        createdAt: true,
      },
    })
  } catch (e) {
    // Prisma P2002 = unique constraint violation. The only unique
    // constraint we own here is (orgId, name) — translate to 409 so
    // the UI can show "name already taken" instead of a 500.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `A module with name "${parsed.data.name}" already exists in this tenant` },
        { status: 409 }
      )
    }
    throw e
  }

  return NextResponse.json({ module: created }, { status: 201 })
})

export const GET = withRlsAuth("settings", "read", async (_req: NextRequest, auth) => {
  const modules = await prisma.codeModule.findMany({
    where: { organizationId: auth.orgId },
    select: {
      id: true,
      name: true,
      description: true,
      triggerType: true,
      isActive: true,
      timeoutMs: true,
      maxLogLines: true,
      sourceHash: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  })

  return NextResponse.json({ modules })
})
