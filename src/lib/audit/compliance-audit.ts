/**
 * Phase 7 slice-2 P0 #3 — compliance audit log helper.
 *
 * Append-only write-side wrapper around `ComplianceAuditLog`. Three
 * typed entry points map to the three compliance categories:
 *   - recordPhiAccess  — R2 Health (HIPAA minimum-necessary)
 *   - recordPiiAccess  — R7 Insurance (state DOI), generic PII (DPA-ish)
 *   - recordFoiaAccess — R8 Public Sector (citizen data, FOIA-able)
 *
 * Schema-level append-only is enforced via DB trigger
 * `compliance_audit_log_append_only_trigger` (UPDATE + DELETE both
 * raise). This helper is a write-only API by design — there's a
 * separate read endpoint for compliance officers / records-request
 * fulfillment, scoped via `loyalty`-style admin RBAC (slice-2 wires
 * that endpoint when R8 FOIA workflow ships).
 *
 * Performance note: writes are best-effort. Compliance logging
 * MUST NOT block the operator's read response (caller still gets
 * patient data even if logging fails). All failures are console-
 * error'd and swallowed; route layer continues. The alternative
 * (block-on-log) was rejected because a misconfigured DB would
 * effectively DoS the entire R2/R7/R8 read surface.
 *
 * Best-effort logging is acceptable per HIPAA — the standard is
 * "reasonable safeguards" not "fail-closed". Real-world hospitals
 * use audit-log-shipping with replay queues; if we ever need
 * stronger semantics, layer a Kafka producer here instead of
 * direct DB writes.
 */
import { prisma } from "@/lib/prisma"
import type { NextRequest } from "next/server"

export type ComplianceRecordType = "phi" | "pii" | "foia"
export type ComplianceAction = "read" | "write" | "export" | "delete"

/**
 * Slim params shape — callers pass only what they know. The route
 * layer pulls userId from `requireAuth(...)` and IP/UA from the
 * NextRequest headers (the `fromRequest` helper below packages
 * both in one call).
 */
export interface RecordAccessParams {
  organizationId: string
  userId: string | null
  action: ComplianceAction
  recordType: ComplianceRecordType
  /** Physical table (e.g. "health_patients", "citizens", "claims"). */
  recordTable: string
  /** ID of the audited row. NULL for list reads. */
  recordId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  /** Optional context: query filters, export format, etc. */
  metadata?: Record<string, unknown>
}

/**
 * Core write — async, never throws. Returns the audit row id on
 * success, null on logging failure (caller continues either way).
 */
export async function recordComplianceAccess(
  params: RecordAccessParams,
): Promise<string | null> {
  try {
    const row = await prisma.complianceAuditLog.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        action: params.action,
        recordType: params.recordType,
        recordTable: params.recordTable,
        recordId: params.recordId ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
        metadata: (params.metadata ?? {}) as object,
      },
      select: { id: true },
    })
    return row.id
  } catch (err) {
    // Best-effort: log + swallow. The route layer must keep responding.
    console.error("[compliance-audit] write failed:", err)
    return null
  }
}

/* ─── Typed convenience wrappers ────────────────────────────────────── */

/**
 * R2 Health — PHI access (patient records, medical records, encounters,
 * care plans). Every read MUST be logged per HIPAA minimum-necessary.
 */
export function recordPhiAccess(
  params: Omit<RecordAccessParams, "recordType">,
): Promise<string | null> {
  return recordComplianceAccess({ ...params, recordType: "phi" })
}

/**
 * R7 Insurance — PII access (policy-holder records, claim files,
 * beneficiaries). State DOI / NAIC require an audit trail.
 */
export function recordPiiAccess(
  params: Omit<RecordAccessParams, "recordType">,
): Promise<string | null> {
  return recordComplianceAccess({ ...params, recordType: "pii" })
}

/**
 * R8 Public Sector — FOIA-able reads (citizens, cases, licenses, grants).
 * Every read is potentially FOIA-able + must be logged with operator
 * id + timestamp for records-request fulfillment.
 */
export function recordFoiaAccess(
  params: Omit<RecordAccessParams, "recordType">,
): Promise<string | null> {
  return recordComplianceAccess({ ...params, recordType: "foia" })
}

/* ─── NextRequest packager ──────────────────────────────────────────── */

/**
 * IPv4 / IPv6-ish format sanity check. Hex digits + dot + colon only.
 * Not a strict RFC 5952 validator — just enough to refuse arbitrary
 * text injection via x-forwarded-for (spoofable header in untrusted-
 * proxy environments). False positives (e.g. "1.2.3.4.evil.example")
 * are rejected because the dot-segment count won't match either
 * IPv4 or IPv6 grammar; we don't try to enforce that — operator
 * who can spoof can also spoof a syntactically-valid IP. This is
 * cheap defense-in-depth, not a security boundary.
 */
const IP_FORMAT_RE = /^[0-9a-fA-F:.]+$/

/**
 * Extract IP from a NextRequest. Headers checked in priority:
 *   1. x-forwarded-for (nginx / cloudflare) — first IP in CSV
 *   2. x-real-ip (fallback when nginx-only)
 * Next.js 16 removed `NextRequest.ip`; we only read trusted-proxy
 * headers. Behind nginx these are set correctly; in untrusted-proxy
 * environments the header is spoofable — we sanity-check the format
 * (hex digits + dot + colon only, max 45 chars for IPv6) and return
 * null on mismatch rather than letting arbitrary text land in the
 * `ipAddress` audit column.
 */
export function ipFromRequest(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first && first.length <= 45 && IP_FORMAT_RE.test(first)) return first
  }
  const xri = req.headers.get("x-real-ip")
  if (xri) {
    const trimmed = xri.trim()
    if (trimmed && trimmed.length <= 45 && IP_FORMAT_RE.test(trimmed)) {
      return trimmed
    }
  }
  return null
}

export function userAgentFromRequest(req: NextRequest): string | null {
  const ua = req.headers.get("user-agent")
  return ua ? ua.slice(0, 500) : null
}

/**
 * One-call audit from a route handler: pulls request metadata + writes
 * the audit row. Use inside R2/R7/R8 GET handlers right after
 * requireAuth returns successfully and the row is loaded.
 *
 * Example:
 *   const auth = await requireAuth(req, "health", "read")
 *   if (isAuthError(auth)) return auth
 *   const patient = await prisma.healthPatient.findFirst({ where: { id, organizationId: auth.orgId }})
 *   if (!patient) return NextResponse.json({error:"not found"}, {status:404})
 *   // Fire-and-forget audit write; do NOT await.
 *   void recordPhiAccessFromRequest(req, auth, {
 *     recordTable: "health_patients",
 *     recordId: patient.id,
 *     action: "read",
 *   })
 *   return NextResponse.json({ patient })
 */
type AuthMinimal = { orgId: string; userId: string }

export function recordPhiAccessFromRequest(
  req: NextRequest,
  auth: AuthMinimal,
  partial: {
    recordTable: string
    recordId?: string | null
    action?: ComplianceAction
    metadata?: Record<string, unknown>
  },
): Promise<string | null> {
  return recordPhiAccess({
    organizationId: auth.orgId,
    userId: auth.userId,
    action: partial.action ?? "read",
    recordTable: partial.recordTable,
    recordId: partial.recordId ?? null,
    ipAddress: ipFromRequest(req),
    userAgent: userAgentFromRequest(req),
    metadata: partial.metadata,
  })
}

export function recordPiiAccessFromRequest(
  req: NextRequest,
  auth: AuthMinimal,
  partial: {
    recordTable: string
    recordId?: string | null
    action?: ComplianceAction
    metadata?: Record<string, unknown>
  },
): Promise<string | null> {
  return recordPiiAccess({
    organizationId: auth.orgId,
    userId: auth.userId,
    action: partial.action ?? "read",
    recordTable: partial.recordTable,
    recordId: partial.recordId ?? null,
    ipAddress: ipFromRequest(req),
    userAgent: userAgentFromRequest(req),
    metadata: partial.metadata,
  })
}

export function recordFoiaAccessFromRequest(
  req: NextRequest,
  auth: AuthMinimal,
  partial: {
    recordTable: string
    recordId?: string | null
    action?: ComplianceAction
    metadata?: Record<string, unknown>
  },
): Promise<string | null> {
  return recordFoiaAccess({
    organizationId: auth.orgId,
    userId: auth.userId,
    action: partial.action ?? "read",
    recordTable: partial.recordTable,
    recordId: partial.recordId ?? null,
    ipAddress: ipFromRequest(req),
    userAgent: userAgentFromRequest(req),
    metadata: partial.metadata,
  })
}
