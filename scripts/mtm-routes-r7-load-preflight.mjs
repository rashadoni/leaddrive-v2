import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

/** @typedef {"base" | "v2"} MtmRoutesR7Stage */
/** @typedef {{ id: string, phase: MtmRoutesR7Stage }} MtmRoutesR7HotPath */
/**
 * @typedef {object} MtmRoutesR7WorkloadManifest
 * @property {number} version
 * @property {number} tenantCount
 * @property {number} provisionedUserCount
 * @property {number} largestTenantConcurrentActiveUsers
 * @property {number} largestTenantPeakConcurrentDataOperations
 * @property {number} largestTenantNormalPeakDataOperationsPerMinute
 * @property {number} largestTenantBurstDataOperationsPerMinute
 * @property {number} largestTenantBurstMaxDurationMinutes
 * @property {string} errorRatePolicy
 * @property {number} maxP95Ms
 * @property {number} maxP99Ms
 * @property {number} maxSystemErrorRateExclusive
 * @property {readonly MtmRoutesR7HotPath[]} requiredHotPaths
 */

/** @type {Readonly<MtmRoutesR7WorkloadManifest>} */
export const MTM_ROUTES_R7_WORKLOAD_MANIFEST = Object.freeze({
  version: 1,
  tenantCount: 100,
  provisionedUserCount: 5_000,
  largestTenantConcurrentActiveUsers: 1_000,
  largestTenantPeakConcurrentDataOperations: 200,
  largestTenantNormalPeakDataOperationsPerMinute: 200,
  largestTenantBurstDataOperationsPerMinute: 400,
  largestTenantBurstMaxDurationMinutes: 5,
  errorRatePolicy: "SYSTEM_ERRORS_EXCLUDE_EXPECTED_BUSINESS_CONFLICTS",
  maxP95Ms: 1_000,
  maxP99Ms: 2_000,
  maxSystemErrorRateExclusive: 0.01,
  requiredHotPaths: Object.freeze([
    { id: "planner_candidates_first_page", phase: "base" },
    { id: "planner_candidates_next_page", phase: "base" },
    { id: "route_list_range", phase: "base" },
    { id: "route_detail_points", phase: "base" },
    { id: "team_week", phase: "base" },
    { id: "visit_list", phase: "base" },
    { id: "visit_workspace", phase: "base" },
    { id: "mobile_v1_week", phase: "base" },
    { id: "mobile_v1_pull", phase: "base" },
    { id: "route_draft_create", phase: "base" },
    { id: "route_draft_update", phase: "base" },
    { id: "route_publish", phase: "base" },
    { id: "visit_action_direct", phase: "base" },
    { id: "web_sync_checkin", phase: "base" },
    { id: "web_sync_checkout", phase: "base" },
    { id: "web_sync_visit_action", phase: "base" },
    { id: "mobile_v1_sync_checkin", phase: "base" },
    { id: "mobile_v1_sync_checkout", phase: "base" },
    { id: "mobile_v1_sync_visit_action", phase: "base" },
    { id: "mobile_v2_route_snapshot", phase: "v2" },
    { id: "mobile_v2_route_delta", phase: "v2" },
  ]),
})

const VALID_STAGES = new Set(["base", "v2"])

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function positiveFinite(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

/**
 * @param {MtmRoutesR7Stage} stage
 * @param {Readonly<MtmRoutesR7WorkloadManifest>} [manifest]
 */
export function hotPathsForMtmRoutesR7Stage(stage, manifest = MTM_ROUTES_R7_WORKLOAD_MANIFEST) {
  if (!VALID_STAGES.has(stage)) return []
  return manifest.requiredHotPaths.filter((hotPath) => stage === "v2" || hotPath.phase === "base")
}

/**
 * Validate the fixed, owner-approved part of the R7 model. It has no network,
 * database, provider or environment side effect and is safe on Contabo.
 */
/** @param {Readonly<MtmRoutesR7WorkloadManifest>} [manifest] */
export function validateMtmRoutesR7WorkloadManifest(manifest = MTM_ROUTES_R7_WORKLOAD_MANIFEST) {
  const errors = []
  if (!isRecord(manifest)) return ["manifest must be an object"]
  if (manifest.version !== 1) errors.push("manifest version must be 1")
  if (manifest.tenantCount !== 100) errors.push("tenantCount must remain 100")
  if (manifest.provisionedUserCount !== 5_000) errors.push("provisionedUserCount must remain 5000")
  if (manifest.largestTenantConcurrentActiveUsers !== 1_000) {
    errors.push("largestTenantConcurrentActiveUsers must remain 1000")
  }
  if (manifest.largestTenantConcurrentActiveUsers > manifest.provisionedUserCount) {
    errors.push("largest tenant concurrency cannot exceed provisioned users")
  }
  if (manifest.largestTenantPeakConcurrentDataOperations !== 200) {
    errors.push("largestTenantPeakConcurrentDataOperations must remain 200")
  }
  if (manifest.largestTenantPeakConcurrentDataOperations > manifest.largestTenantConcurrentActiveUsers) {
    errors.push("largest tenant peak data operations cannot exceed active users")
  }
  if (manifest.largestTenantNormalPeakDataOperationsPerMinute !== 200) {
    errors.push("largestTenantNormalPeakDataOperationsPerMinute must remain 200")
  }
  if (manifest.largestTenantBurstDataOperationsPerMinute !== 400) {
    errors.push("largestTenantBurstDataOperationsPerMinute must remain 400")
  }
  if (manifest.largestTenantBurstMaxDurationMinutes !== 5) {
    errors.push("largestTenantBurstMaxDurationMinutes must remain 5")
  }
  if (manifest.errorRatePolicy !== "SYSTEM_ERRORS_EXCLUDE_EXPECTED_BUSINESS_CONFLICTS") {
    errors.push("errorRatePolicy must exclude expected business conflicts from system errors")
  }
  if (manifest.maxP95Ms !== 1_000) errors.push("maxP95Ms must remain 1000")
  if (manifest.maxP99Ms !== 2_000) errors.push("maxP99Ms must remain 2000")
  if (manifest.maxSystemErrorRateExclusive !== 0.01) {
    errors.push("maxSystemErrorRateExclusive must remain 0.01")
  }
  if (!Array.isArray(manifest.requiredHotPaths) || manifest.requiredHotPaths.length === 0) {
    errors.push("requiredHotPaths must be a non-empty array")
    return errors
  }
  const ids = new Set()
  for (const hotPath of manifest.requiredHotPaths) {
    if (!isRecord(hotPath) || typeof hotPath.id !== "string" || !hotPath.id) {
      errors.push("each hot path needs a non-empty id")
      continue
    }
    if (!VALID_STAGES.has(hotPath.phase)) errors.push(`hot path ${hotPath.id} has an invalid phase`)
    if (ids.has(hotPath.id)) errors.push(`hot path ${hotPath.id} is duplicated`)
    ids.add(hotPath.id)
  }
  return errors
}

/**
 * A profile may be supplied only by an owner-approved, isolated heavy-runner
 * job. The validator intentionally refuses to infer request rates or SLOs.
 */
export function validateMtmRoutesR7ExecutionInputs(input, manifest = MTM_ROUTES_R7_WORKLOAD_MANIFEST) {
  const errors = validateMtmRoutesR7WorkloadManifest(manifest)
  if (!isRecord(input)) return [...errors, "execution input must be an object"]

  const stage = input.stage ?? "base"
  if (!VALID_STAGES.has(stage)) return [...errors, "stage must be base or v2"]
  if (input.targetKind !== "isolated-production-like") {
    errors.push("targetKind must be isolated-production-like")
  }
  if (input.isolatedTargetConfirmed !== true) {
    errors.push("isolated target confirmation is required")
  }

  const requiredIds = hotPathsForMtmRoutesR7Stage(stage, manifest).map((hotPath) => hotPath.id)
  const requestOperations = isRecord(input.requestMix) && isRecord(input.requestMix.operations)
    ? input.requestMix.operations
    : null
  const requestWorkload = isRecord(input.requestMix) && isRecord(input.requestMix.workload)
    ? input.requestMix.workload
    : null
  const sloOperations = isRecord(input.slo) && isRecord(input.slo.operations)
    ? input.slo.operations
    : null
  if (!requestOperations) errors.push("owner-approved request mix is required")
  else if (input.requestMix.approvalStatus !== "OWNER_APPROVED") {
    errors.push("request mix must be explicitly marked OWNER_APPROVED")
  }
  if (!requestWorkload) {
    errors.push("request mix needs the approved logical data-operation envelope")
  } else {
    if (requestWorkload.normalPeakLogicalDataOperationsPerMinute !== manifest.largestTenantNormalPeakDataOperationsPerMinute) {
      errors.push("request mix normal peak must match the approved logical data-operation envelope")
    }
    if (requestWorkload.burstLogicalDataOperationsPerMinute !== manifest.largestTenantBurstDataOperationsPerMinute) {
      errors.push("request mix burst must match the approved logical data-operation envelope")
    }
    if (requestWorkload.burstMaxDurationMinutes !== manifest.largestTenantBurstMaxDurationMinutes) {
      errors.push("request mix burst duration must match the approved logical data-operation envelope")
    }
  }
  if (!sloOperations) errors.push("owner-approved SLO profile is required")
  else if (input.slo.approvalStatus !== "OWNER_APPROVED") {
    errors.push("SLO profile must be explicitly marked OWNER_APPROVED")
  } else if (input.slo.errorRatePolicy !== manifest.errorRatePolicy) {
    errors.push("SLO error rate policy must match the approved conflict classification")
  }

  for (const id of requiredIds) {
    const request = requestOperations?.[id]
    if (!isRecord(request) || !positiveFinite(request.requestsPerMinute)) {
      errors.push(`request mix needs a positive requestsPerMinute for ${id}`)
    }

    const slo = sloOperations?.[id]
    if (!isRecord(slo) || !positiveFinite(slo.p95Ms) || !positiveFinite(slo.p99Ms)) {
      errors.push(`SLO needs positive p95Ms and p99Ms for ${id}`)
      continue
    }
    if (slo.p99Ms < slo.p95Ms) errors.push(`SLO p99Ms must be at least p95Ms for ${id}`)
    if (slo.p95Ms > manifest.maxP95Ms) errors.push(`SLO p95Ms exceeds approved ${manifest.maxP95Ms}ms for ${id}`)
    if (slo.p99Ms > manifest.maxP99Ms) errors.push(`SLO p99Ms exceeds approved ${manifest.maxP99Ms}ms for ${id}`)
    if (typeof slo.maxErrorRate !== "number" || !Number.isFinite(slo.maxErrorRate) || slo.maxErrorRate < 0 || slo.maxErrorRate >= 1) {
      errors.push(`SLO maxErrorRate must be in [0, 1) for ${id}`)
    } else if (slo.maxErrorRate >= manifest.maxSystemErrorRateExclusive) {
      errors.push(`SLO maxErrorRate must remain below approved ${manifest.maxSystemErrorRateExclusive} for ${id}`)
    }
  }

  return errors
}

/**
 * @param {string | undefined} path
 * @param {string} label
 * @param {(path: string, encoding: "utf8") => string} readFile
 */
function readProfile(path, label, readFile) {
  if (!path) return { value: null, errors: [`${label} file is required`] }
  try {
    return { value: JSON.parse(readFile(path, "utf8")), errors: [] }
  } catch {
    return { value: null, errors: [`${label} file must be readable JSON`] }
  }
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {(path: string, encoding: "utf8") => string} [readFile]
 */
export function validateMtmRoutesR7Environment(env = process.env, readFile = readFileSync) {
  const requestMix = readProfile(env.MTM_R7_REQUEST_MIX_FILE, "request mix", readFile)
  const slo = readProfile(env.MTM_R7_SLO_FILE, "SLO", readFile)
  const errors = [
    ...requestMix.errors,
    ...slo.errors,
    ...validateMtmRoutesR7ExecutionInputs({
      stage: env.MTM_R7_STAGE ?? "base",
      targetKind: env.MTM_R7_TARGET_KIND,
      isolatedTargetConfirmed: env.MTM_R7_ISOLATED_TARGET_CONFIRMATION === "confirmed",
      requestMix: requestMix.value,
      slo: slo.value,
    }),
  ]
  return [...new Set(errors)]
}

export function runMtmRoutesR7LoadPreflight(args = process.argv.slice(2), env = process.env) {
  const manifestErrors = validateMtmRoutesR7WorkloadManifest()
  if (manifestErrors.length > 0) {
    console.error(`[mtm-routes-r7] invalid manifest: ${manifestErrors.join("; ")}`)
    return 1
  }
  if (!args.includes("--assert-ready")) {
    console.log("[mtm-routes-r7] manifest valid; no load test was started")
    return 0
  }
  const errors = validateMtmRoutesR7Environment(env)
  if (errors.length > 0) {
    console.error(`[mtm-routes-r7] not ready: ${errors.join("; ")}`)
    return 1
  }
  console.log("[mtm-routes-r7] preflight valid; this command does not start a load test")
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runMtmRoutesR7LoadPreflight()
}
