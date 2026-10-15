import { withMobileRls } from "@/lib/with-mobile-rls"
import { prisma } from "@/lib/prisma"
import { readFormDataRequestWithinLimit } from "@/lib/request-body-limit"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { requireAttendanceSelf } from "@/lib/mtm/attendance-request-store"
import { MAX_ATTENDANCE_ATTACHMENT_BYTES, uploadAttendanceDocument } from "@/lib/mtm/attendance-attachment"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { acquirePublicConcurrencySlot, consumePublicRateLimitBatch, releasePublicConcurrencySlot, type PublicConcurrencyReservation } from "@/lib/public-abuse-guard"

export const POST = withMobileRls(async (req, auth) => {
  const self = { organizationId: auth.orgId, agentId: auth.agentId, role: auth.role }
  const slots: PublicConcurrencyReservation[] = []
  let retryAfter = 0
  try {
    await requireAttendanceSelf(prisma, self)
    // Admission precedes reading multipart bytes or decoding an image. Both
    // noisy retries by one agent and parallel uploads across tenants are bounded.
    const rate = await consumePublicRateLimitBatch([
      { scope: "attendance-document-agent", identifier: `${auth.orgId}:${auth.agentId}`, identifierMode: "exact", redisHashTag: "attendance-documents", policy: { maxRequests: 12, windowSeconds: 60 } },
      { scope: "attendance-document-tenant", identifier: auth.orgId, identifierMode: "exact", redisHashTag: "attendance-documents", policy: { maxRequests: 120, windowSeconds: 60 } },
    ])
    if (!rate.allowed) {
      retryAfter = rate.retryAfterSeconds
      throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_BUSY", rate.unavailable ? 503 : 429)
    }
    for (const [scope, key, maxConcurrent] of [
      ["attendance-document-global", "all", 4],
      ["attendance-document-tenant", auth.orgId, 2],
      ["attendance-document-agent", `${auth.orgId}:${auth.agentId}`, 1],
    ] as const) {
      const slot = await acquirePublicConcurrencySlot(scope, key, { maxConcurrent, leaseSeconds: 120 })
      slots.push(slot)
      if (!slot.allowed) {
        retryAfter = slot.retryAfterSeconds
        throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_BUSY", slot.unavailable ? 503 : 429)
      }
    }
    const body = await readFormDataRequestWithinLimit(req, MAX_ATTENDANCE_ATTACHMENT_BYTES + 32_768)
    if (!body.ok) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_INVALID", body.reason === "too_large" ? 413 : 400)
    const file = body.value.get("file")
    if (!(file instanceof File)) throw new AttendanceRequestError("MTM_ATTENDANCE_DOCUMENT_IMAGE_REQUIRED", 400)
    const result = await uploadAttendanceDocument(self, { clientRequestId: body.value.get("clientRequestId"), clientAttachmentId: body.value.get("clientAttachmentId") }, new Uint8Array(await file.arrayBuffer()))
    return attendanceRequestResponse(result, result.idempotent ? 200 : 201)
  } catch (error) {
    const response = attendanceRequestFailure(error)
    if (retryAfter > 0) response.headers.set("retry-after", String(Math.max(1, Math.ceil(retryAfter))))
    return response
  } finally { for (const slot of slots.reverse()) await releasePublicConcurrencySlot(slot) }
}, { requiredCapability: "personnel" })
