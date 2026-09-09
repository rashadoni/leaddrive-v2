import { NextResponse } from "next/server"
import { MAX_MOBILE_DOCUMENT_BYTES } from "@/lib/mtm/mobile-document"
import {
  readMtmMobileMediaUploadPolicy,
  mtmMobileMediaDeviceCohortRequiredResponse,
  requireMtmMobileMediaAccess,
} from "@/lib/mtm/mobile-media-guard"
import { withMobileRls } from "@/lib/with-mobile-rls"

const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const MULTIPART_OVERHEAD_BYTES = 1_024 * 1_024

/**
 * Authenticated media preflight for the Field supervisor.
 *
 * It intentionally returns the server-selected contract and hard body limits
 * before a client sends a file. It is advisory: POST repeats admission before
 * reading the multipart body, so a response cannot be replayed or forged to
 * bypass tenant/user/device fairness.
 */
export const GET = withMobileRls(async (req, auth) => {
  const forbidden = await requireMtmMobileMediaAccess(auth)
  if (forbidden) return forbidden

  const policy = await readMtmMobileMediaUploadPolicy({
    auth,
    deviceId: req.headers.get("x-field-device-id"),
  })
  if (policy.requiresDeviceCohort) return mtmMobileMediaDeviceCohortRequiredResponse()

  return NextResponse.json(
    {
      success: true,
      data: {
        contractVersion: policy.contractVersion,
        isolated: policy.isolated,
        admission: policy.isolated ? "server_guarded" : "legacy_compatibility",
        maxFileBytes: {
          photo: MAX_PHOTO_BYTES,
          document: MAX_MOBILE_DOCUMENT_BYTES,
        },
        maxMultipartBytes: {
          photo: MAX_PHOTO_BYTES + MULTIPART_OVERHEAD_BYTES,
          document: MAX_MOBILE_DOCUMENT_BYTES + MULTIPART_OVERHEAD_BYTES,
        },
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  )
})
