import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"
import { isOutboundVoiceDispatchPaused } from "@/lib/voip/outbound-dispatch-gate"

export const dynamic = "force-dynamic"

const PROTOCOL = "leaddrive-voice-maintenance-v1"
const REQUEST_PROTOCOL = "leaddrive-voice-maintenance-request-v1"
const PATH = "/api/internal/voice-agent/maintenance-attestation"
const SIGNATURE_HEADER = "X-Fanum-Maintenance-Signature"
const SIGNATURE_DOMAIN = "fanum-crm-maintenance-response-v1"
const SHA_PATTERN = /^[0-9a-f]{40}$/
const CHALLENGE_PATTERN = /^[0-9a-f]{64}$/
const ATTESTATION_TTL_MS = 30_000

type MaintenanceRequest = {
  challenge: string
  expectedDeploymentSha: string
}

function runtimeToken(): Buffer | null {
  const raw = process.env.FANUM_VOICE_RUNTIME_TOKEN || ""
  const value = Buffer.from(raw, "utf8")
  if (
    value.length < 16
    || value.length > 4_096
    || value.some((byte) => byte < 0x21 || byte === 0x7f)
  ) return null
  return value
}

function authorized(request: NextRequest, token: Buffer): boolean {
  const raw = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || ""
  const received = Buffer.from(raw, "utf8")
  return received.length === token.length && timingSafeEqual(received, token)
}

async function deployedSha(): Promise<string | null> {
  try {
    const value = (await readFile(join(process.cwd(), ".deploy-sha"), "utf8")).trim()
    return SHA_PATTERN.test(value) ? value : null
  } catch {
    return null
  }
}

async function maintenanceRequest(request: NextRequest): Promise<MaintenanceRequest | null> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    return null
  }
  const declaredLength = Number(request.headers.get("content-length") || "0")
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > 1_024) {
    return null
  }
  try {
    const raw = await request.text()
    if (raw.length === 0 || raw.length > 1_024) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (
      Object.keys(record).length !== 3
      || record.protocol !== REQUEST_PROTOCOL
      || typeof record.challenge !== "string"
      || !CHALLENGE_PATTERN.test(record.challenge)
      || typeof record.expectedDeploymentSha !== "string"
      || !SHA_PATTERN.test(record.expectedDeploymentSha)
    ) return null
    return {
      challenge: record.challenge,
      expectedDeploymentSha: record.expectedDeploymentSha,
    }
  } catch {
    return null
  }
}

function signedResponse(token: Buffer, payload: Record<string, unknown>): NextResponse {
  const body = JSON.stringify(payload)
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex")
  const message = [SIGNATURE_DOMAIN, "POST", PATH, "200", bodyHash].join("\n")
  const signature = createHmac("sha256", token).update(message, "utf8").digest("hex")
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      [SIGNATURE_HEADER]: `v1=${signature}`,
    },
  })
}

/**
 * PBX pre-mutation attestation. It is intentionally valid only while the
 * legacy registry mode is fully off and the exact pilot is durably paused.
 * No call/provider endpoint is invoked and no customer data is returned.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const token = runtimeToken()
  if (!token || !authorized(request, token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const requestProof = await maintenanceRequest(request)
  if (!requestProof) {
    return NextResponse.json({ error: "Invalid maintenance challenge" }, { status: 400 })
  }
  const organizationId = process.env.VOICE_AGENT_ORGANIZATION_ID?.trim() || ""
  const deploymentSha = await deployedSha()
  if (!organizationId || !deploymentSha) {
    return NextResponse.json({ error: "Maintenance attestation unavailable" }, { status: 503 })
  }
  if (deploymentSha !== requestProof.expectedDeploymentSha) {
    return NextResponse.json({ error: "Reviewed deployment revision mismatch" }, { status: 409 })
  }
  if (
    process.env.VOICE_OUTBOUND_CALL_DISPATCH_PAUSED !== "true"
    || process.env.VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED !== "false"
    || !isOutboundVoiceDispatchPaused(organizationId)
  ) {
    return NextResponse.json({ error: "Outbound voice is not in maintenance mode" }, { status: 409 })
  }

  const proof = await runWithTenant(organizationId, () => prisma.$transaction(async (tx) => {
    // Do not deserialize the PostgreSQL void returned by the advisory lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`voip-config:${organizationId}`}, 0))`
    const configs = await tx.$queryRaw<Array<{ settings: Prisma.JsonValue }>>(Prisma.sql`
      SELECT settings
      FROM channel_configs
      WHERE "organizationId" = ${organizationId}
        AND "channelType" = 'voip'
        AND "isActive" = true
        AND lower(coalesce(settings->>'provider', '')) = 'asterisk'
      ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
      FOR SHARE
    `)
    if (configs.length !== 1) return null
    const settings = configs[0].settings
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null
    const record = settings as Record<string, unknown>
    if (
      record.outboundCallDispatchPaused !== true
      || record.voiceAttemptRegistryEnabled === true
      || (
        Object.prototype.hasOwnProperty.call(record, "voiceAttemptRegistryEnabled")
        && typeof record.voiceAttemptRegistryEnabled !== "boolean"
      )
    ) return null

    const sessions = await tx.voiceCallSession.count({
      where: {
        organizationId,
        endedAt: null,
        OR: [
          { activeOrganizationKey: { not: null } },
          { activeLeadKey: { not: null } },
          { activePhoneKey: { not: null } },
        ],
      },
    })
    const calls = await tx.callLog.count({
      where: {
        organizationId,
        provider: "asterisk",
        direction: "outbound",
        endedAt: null,
        providerOutcome: null,
      },
    })
    return sessions === 0 && calls === 0
      ? { activeSessions: sessions, activeCalls: calls }
      : null
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }))

  if (!proof) {
    return NextResponse.json({ error: "Outbound voice maintenance proof failed" }, { status: 409 })
  }
  const issuedAtMs = Date.now()
  return signedResponse(token, {
    protocol: PROTOCOL,
    challenge: requestProof.challenge,
    deploymentSha,
    issuedAt: new Date(issuedAtMs).toISOString(),
    expiresAt: new Date(issuedAtMs + ATTESTATION_TTL_MS).toISOString(),
    dispatchPaused: true,
    registryEnabled: false,
    activeSessions: 0,
    activeCalls: 0,
    callsPlaced: 0,
  })
}
