import { NextRequest, NextResponse } from "next/server"
import { runWithTenant } from "@/lib/rls-context"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"
import {
  applyFacebookNativeSearchResultBatch,
  decodeFacebookNativeSearchBody,
  facebookNativeWorkerConfiguration,
  parseFacebookNativeSearchResultBatch,
  readFacebookNativeSearchBody,
  resolveFacebookNativeWorkerOrganization,
  validateFacebookNativeSearchTransport,
  verifyFacebookNativeWorkerAuthorization,
  type FacebookNativeSearchResultBatch,
} from "@/lib/social/facebook-native-search-worker"

export async function POST(request: NextRequest) {
  const configuration = facebookNativeWorkerConfiguration()
  if (!configuration.enabled) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }
  if (!configuration.configured) {
    return NextResponse.json({ error: "facebook_native_worker_not_configured" }, { status: 503 })
  }
  if (!verifyFacebookNativeWorkerAuthorization(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }
  const transport = validateFacebookNativeSearchTransport(request.headers)
  if (!transport.valid) {
    return NextResponse.json({ error: transport.reason }, { status: transport.status })
  }

  let payload: FacebookNativeSearchResultBatch
  try {
    const bytes = await readFacebookNativeSearchBody(request)
    const decoded = decodeFacebookNativeSearchBody(bytes)
    payload = parseFacebookNativeSearchResultBatch(decoded)
  } catch (error) {
    const reason = error instanceof Error ? error.message : "facebook_native_worker_payload_invalid"
    return NextResponse.json({ error: reason }, {
      status: reason === "facebook_native_worker_payload_too_large" ? 413 : 400,
    })
  }

  const organization = await resolveFacebookNativeWorkerOrganization()
  if (!organization) {
    return NextResponse.json({ error: "facebook_native_worker_tenant_unavailable" }, { status: 503 })
  }

  try {
    const fenced = await runWithTenant(organization.id, () =>
      withSocialMonitoringTenantCollectionFence(
        organization.id,
        () => applyFacebookNativeSearchResultBatch(organization.id, payload),
      ),
    )
    if (!fenced.allowed) {
      return NextResponse.json({ error: fenced.reason }, { status: 409 })
    }
    return NextResponse.json({ success: true, data: fenced.value })
  } catch (error) {
    if (error instanceof Error && error.message === "facebook_native_worker_job_inactive") {
      // This immutable scenario/source binding no longer exists. Retrying the
      // same result batch can never succeed, so let the worker retire it.
      return NextResponse.json({ error: error.message }, { status: 410 })
    }
    if (error instanceof Error && error.message.startsWith("facebook_native_worker_")) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error("[facebook-native-search-worker] result persistence failed")
    return NextResponse.json({ error: "facebook_native_worker_failed" }, { status: 500 })
  }
}
