import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { NextRequest } from "next/server"

/**
 * Canonical audit-action constants. Exported so callers don't risk
 * string-typo drift (which silently splits the audit channel and
 * defeats greppability).
 *
 * Established by M1-2 (photo watermark) — when an uploaded photo fails
 * EXIF/GPS validation in a way that suggests tampering rather than a
 * benign client bug, the route writes this action to MtmAuditLog so
 * supervisors can review.
 */
export const PHOTO_TAMPER_DETECTED = "PHOTO_TAMPER_DETECTED"

/**
 * M3-5a: photo GPS is >100m from the claimed customer's stored location.
 * Soft signal — could be agent legitimately taking the photo from across
 * the street, but a pattern of these from one rep is anti-fraud-grade
 * evidence. newData carries `distanceMeters`, `photoCoords`, `customerCoords`
 * for forensic review.
 */
export const PHOTO_GPS_VS_CUSTOMER_MISMATCH = "PHOTO_GPS_VS_CUSTOMER_MISMATCH"

/**
 * M3-5a: visit-anomaly lookup itself failed (DB hiccup, malformed visitId).
 * Without this signal, photos
 * silently skip the cross-customer GPS check and supervisors lose
 * visibility into the gap.
 */
export const PHOTO_ANOMALY_CHECK_FAILED = "PHOTO_ANOMALY_CHECK_FAILED"


/**
 * M3-5b: anti-fraud burst signal. An agent uploading >5 photos within 30
 * seconds is likely automating uploads to fabricate visit evidence.
 * Written by the photo-upload route immediately after `mtmPhoto.create`.
 * newData carries `burstCount` (the window count that triggered it).
 */
export const PHOTO_BURST_SUSPICIOUS = "PHOTO_BURST_SUSPICIOUS"


/**
 * Write an entry to the MtmAuditLog table.
 * Always call with .catch(() => {}) so it never fails the main request.
 */
export async function writeMtmAudit(params: {
  organizationId: string
  agentId: string | null | undefined
  // Common actions: CHECK_IN, CHECK_IN_FORCED, CHECK_OUT, TASK_COMPLETE, PHOTO_UPLOAD,
  // PHOTO_REVIEW, ROUTE_CREATE/UPDATE/DELETE, AGENT_CREATE/UPDATE/DELETE,
  // CUSTOMER_CREATE/UPDATE/DELETE, SETTINGS_UPDATE, AUTO_LINK, MOBILE_LOGIN, MOBILE_LOGIN_FAILED
  action: string
  entity: string // visit, task, photo, route, agent, customer, settings
  entityId: string | null | undefined
  metadataKind?: string | null // F-29: indexed kind for fast filters
  oldData?: unknown
  newData?: unknown
  req?: NextRequest // to extract IP and user agent
}) {
  const ipAddress =
    params.req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    params.req?.headers.get("x-real-ip") ||
    null
  const userAgent = params.req?.headers.get("user-agent") || null

  await prisma.mtmAuditLog.create({
    data: {
      organizationId: params.organizationId,
      agentId: params.agentId ?? null,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId ?? null,
      metadataKind: params.metadataKind ?? null,
      oldData: (params.oldData ?? undefined) as Prisma.InputJsonValue | undefined,
      newData: (params.newData ?? undefined) as Prisma.InputJsonValue | undefined,
      ipAddress,
      userAgent,
    },
  })
}
