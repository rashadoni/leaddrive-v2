/**
 * POST /api/v1/platform-events/publish
 *
 * Publish a platform event. Body: `{ eventName, payload }`. The
 * payload is validated against the named definition's fields spec;
 * on success a PlatformEventLog row is written + the in-memory bus
 * fans out to any subscribers in this process.
 *
 * Slice 1 only supports the "manual" origin (caller-driven publish).
 * Slice 2 routes from the Prisma CDC middleware + Apex sandbox +
 * Flow Builder, all setting their own `origin` tag.
 *
 * Part of N14 Platform Events (Phase 5 slice 1).
 */
import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { dispatchMarketplaceConnectorEvent } from "@/lib/apps/connector-runtime"
import { defaultBus } from "@/lib/platform-events/event-bus"
import {
  parseFieldSpecs,
  validatePayload,
} from "@/lib/platform-events/payload-validator"

const bodySchema = z.object({
  eventName: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z_][a-z0-9_]*$/i, "eventName must be a valid identifier"),
  payload: z.record(z.string(), z.unknown()),
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

export const POST = withRlsAuth("ai", "write", async (req, auth) => {
  // `ai:write` scope — closest existing match to a "workflow-style
  // side-effect channel" in the permissions matrix (matches H3
  // sandbox + agent-sessions). The Module enum has no dedicated
  // `automation` / `platformEvents` scope yet; slice 2 will carve
  // one out alongside the WebSocket subscriber endpoint so a
  // workflow-only API key can publish without granting broader AI
  // access. settings:write is reserved for definition management.

  const body = await readBody(req)
  if (body instanceof NextResponse) return body
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const definition = await prisma.platformEventDefinition.findFirst({
    where: {
      organizationId: auth.orgId,
      name: parsed.data.eventName,
    },
    select: { id: true, isActive: true, fields: true },
  })
  if (!definition) {
    return NextResponse.json(
      { error: `No platform-event definition named "${parsed.data.eventName}" in this tenant` },
      { status: 404 }
    )
  }
  if (!definition.isActive) {
    return NextResponse.json(
      { error: `Platform-event definition "${parsed.data.eventName}" is inactive` },
      { status: 409 }
    )
  }

  let specs
  try {
    specs = parseFieldSpecs(definition.fields)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Invalid definition fields" },
      { status: 422 }
    )
  }

  const validation = validatePayload(parsed.data.payload, specs)
  if (!validation.ok) {
    return NextResponse.json(
      { error: "Payload failed validation", details: validation.errors },
      { status: 400 }
    )
  }

  // Durable log first — guarantees the event survives a crash even
  // if the in-memory bus delivery is lost. Slice 2's Redis Streams
  // publisher gets called AFTER this write completes.
  const logRow = await prisma.platformEventLog.create({
    data: {
      organizationId: auth.orgId,
      definitionId: definition.id,
      eventName: parsed.data.eventName,
      payload: validation.payload as unknown as Prisma.InputJsonValue,
      origin: "manual",
      publishedBy: auth.userId,
    },
    select: {
      id: true,
      definitionId: true,
      eventName: true,
      publishedAt: true,
    },
  })

  defaultBus.publish({
    id: logRow.id,
    organizationId: auth.orgId,
    definitionId: definition.id,
    eventName: parsed.data.eventName,
    payload: validation.payload,
    origin: "manual",
    publishedBy: auth.userId,
    publishedAt: logRow.publishedAt,
  })
  dispatchMarketplaceConnectorEvent(auth.orgId, parsed.data.eventName, validation.payload).catch((error) => {
    console.error(`[platform-events] marketplace connector dispatch failed for ${parsed.data.eventName}:`, error)
  })

  return NextResponse.json({ event: logRow }, { status: 201 })
})
