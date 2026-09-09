/**
 * POST /api/v1/named-credentials/[id]/test
 *
 * Issue a HEAD request against the credential's baseUrl with the
 * configured auth header applied. Updates `testStatus` /
 * `testStatusMessage` / `testedAt`. Lets a user verify that the
 * secret + baseUrl are working before wiring the credential into a
 * flow or code module.
 *
 * Part of N17 Named Credentials (Phase 5 slice 1).
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { decryptSecret } from "@/lib/credentials/vault"
import type { ResolvedCredential } from "@/lib/credentials/types"
import {
  ExternalServiceError,
  callExternalService,
} from "@/lib/external-services/client"
import { withRlsAuth } from "@/lib/with-rls"

export const POST = withRlsAuth("settings", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const row = await prisma.namedCredential.findFirst({
    where: { id, organizationId: auth.orgId },
  })
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!row.isActive) {
    return NextResponse.json({ error: "Credential is inactive" }, { status: 409 })
  }

  let secret: string | null = null
  if (row.authType !== "none") {
    if (!row.secretCiphertext || !row.secretIv || !row.secretTag || !row.secretAlg) {
      return NextResponse.json(
        { error: "Credential is corrupted — missing ciphertext components" },
        { status: 500 }
      )
    }
    try {
      secret = decryptSecret({
        organizationId: auth.orgId,
        name: row.name,
        encrypted: {
          ciphertext: row.secretCiphertext,
          iv: row.secretIv,
          tag: row.secretTag,
          alg: row.secretAlg as "aes-256-gcm-v1",
        },
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await prisma.namedCredential.update({
        where: { id },
        data: {
          testStatus: "failed",
          testStatusMessage: `Decryption failed: ${msg}`,
          testedAt: new Date(),
        },
      })
      return NextResponse.json(
        { error: `Decryption failed: ${msg}` },
        { status: 422 }
      )
    }
  }

  const credential: ResolvedCredential = {
    id: row.id,
    name: row.name,
    organizationId: row.organizationId,
    baseUrl: row.baseUrl,
    authType: row.authType as ResolvedCredential["authType"],
    authConfig: (row.authConfig ?? {}) as Record<string, unknown>,
    secret,
  }

  let status: "ok" | "failed"
  let message: string | null = null
  try {
    const res = await callExternalService({
      credential,
      method: "HEAD",
      path: "/",
      timeoutMs: 5000,
    })
    // Status mapping (architect-flagged: green-tick on 401 was misleading):
    //   2xx           → ok
    //   3xx           → ok (server reachable, redirect chain ignored at HEAD)
    //   401/403/4xx   → failed (auth or client-side rejection)
    //   5xx           → failed (upstream broken)
    //
    // The "HEAD not allowed" case is 405; we map that as `failed` too —
    // user must whitelist a different test path or pre-warm a GET in
    // slice 2. Better to surface than to fake a green tick.
    if (res.status >= 200 && res.status < 400) {
      status = "ok"
      message = `HTTP ${res.status} (${res.durationMs}ms)`
    } else {
      status = "failed"
      message = `HTTP ${res.status} (${res.durationMs}ms) — non-2xx response`
    }
  } catch (e) {
    status = "failed"
    if (e instanceof ExternalServiceError) {
      message = `[${e.kind}] ${e.message}`
    } else {
      message = e instanceof Error ? e.message : String(e)
    }
  }

  await prisma.namedCredential.update({
    where: { id },
    data: {
      testStatus: status,
      testStatusMessage: message,
      testedAt: new Date(),
    },
  })

  return NextResponse.json({ status, message })
})
