import { NextRequest, NextResponse } from "next/server"
import { runWithTenant } from "@/lib/rls-context"
import { withSocialMonitoringTenantCollectionFence } from "@/lib/social/monitoring-import-fence"
import {
  FACEBOOK_NATIVE_SEARCH_JOBS_SCHEMA_VERSION,
  FACEBOOK_NATIVE_SEARCH_MAX_BATCH_ITEMS,
  FACEBOOK_NATIVE_SEARCH_MAX_QUERIES,
  FACEBOOK_NATIVE_SEARCH_MAX_SUBJECTS,
  FACEBOOK_NATIVE_SEARCH_MAX_TARGETS_PER_JOB,
  facebookNativeWorkerConfiguration,
  listFacebookNativeSearchJobs,
  resolveFacebookNativeWorkerOrganization,
  verifyFacebookNativeWorkerAuthorization,
} from "@/lib/social/facebook-native-search-worker"

export async function GET(request: NextRequest) {
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
  const organization = await resolveFacebookNativeWorkerOrganization()
  if (!organization) {
    return NextResponse.json({ error: "facebook_native_worker_tenant_unavailable" }, { status: 503 })
  }

  try {
    const fenced = await runWithTenant(organization.id, () =>
      withSocialMonitoringTenantCollectionFence(
        organization.id,
        () => listFacebookNativeSearchJobs(organization.id),
      ),
    )
    if (!fenced.allowed) {
      return NextResponse.json({ error: fenced.reason }, { status: 409 })
    }
    return NextResponse.json({
      success: true,
      data: {
        schemaVersion: FACEBOOK_NATIVE_SEARCH_JOBS_SCHEMA_VERSION,
        limits: {
          maxJobs: FACEBOOK_NATIVE_SEARCH_MAX_QUERIES,
          maxSubjects: FACEBOOK_NATIVE_SEARCH_MAX_SUBJECTS,
          maxBatchItems: FACEBOOK_NATIVE_SEARCH_MAX_BATCH_ITEMS,
          maxTargetsPerJob: FACEBOOK_NATIVE_SEARCH_MAX_TARGETS_PER_JOB,
        },
        jobs: fenced.value,
      },
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : ""
    if (
      reason === "facebook_native_worker_job_capacity_exceeded"
      || reason === "facebook_native_worker_subject_capacity_exceeded"
      || reason === "facebook_native_worker_query_capacity_exceeded"
      || reason === "facebook_native_worker_target_group_too_large"
    ) {
      return NextResponse.json({ error: reason }, { status: 409 })
    }
    console.error("[facebook-native-search-worker] job listing failed")
    return NextResponse.json({ error: "facebook_native_worker_failed" }, { status: 500 })
  }
}
