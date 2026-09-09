export function findQaPromotionReviewExecutionId(payload, evidenceAgentId) {
  if (!evidenceAgentId || payload?.data?.capabilities?.canReview !== true) return null
  const rows = Array.isArray(payload?.data?.rows) ? payload.data.rows : []
  const row = rows.find((candidate) => (
    String(candidate?.employee?.id || "") === evidenceAgentId
    && String(candidate?.employee?.name || "").includes("[QA-SWISSMED] Field Agent")
    && candidate?.target?.customerCode === "QA-SWM-PHARMACY"
    && String(candidate?.target?.customerName || "").includes("[QA-SWISSMED]")
    && (candidate?.currentStep === "L1" || candidate?.currentStep === "L2")
    && candidate?.policy?.ready === true
  ))
  return row?.id ? String(row.id) : null
}

export function findQaLiveAgentId(payload, evidenceAgentId) {
  if (!evidenceAgentId) return null
  const agents = Array.isArray(payload?.data?.agentLocations) ? payload.data.agentLocations : []
  const agent = agents.find((candidate) => (
    String(candidate?.agentId || "") === evidenceAgentId
    && String(candidate?.name || "").includes("[QA-SWISSMED] Field Agent")
    && (candidate?.freshness === "ONLINE" || candidate?.freshness === "DELAYED")
    && candidate?.locationState === "AVAILABLE"
    && typeof candidate?.latitude === "number"
    && Number.isFinite(candidate.latitude)
    && candidate.latitude >= -90
    && candidate.latitude <= 90
    && typeof candidate?.longitude === "number"
    && Number.isFinite(candidate.longitude)
    && candidate.longitude >= -180
    && candidate.longitude <= 180
    && typeof candidate?.recordedAt === "string"
    && Number.isFinite(Date.parse(candidate.recordedAt))
  ))
  return agent?.agentId ? String(agent.agentId) : null
}

export function isProductionEvidenceTarget(value) {
  try {
    const target = new URL(value)
    return target.protocol === "https:"
      && target.hostname.replace(/\.$/, "").toLowerCase() === "app.leaddrivecrm.org"
      && target.port === ""
  } catch {
    return false
  }
}

export function consoleErrorBucket(url, baseURL, baseOrigin, telemetryRequestUrls = new Set()) {
  if (!url) return "blocking"
  try {
    const source = new URL(url, baseURL)
    if (source.origin === baseOrigin && telemetryRequestUrls.has(source.href)) {
      return "telemetry"
    }
    if ((source.protocol === "http:" || source.protocol === "https:") && source.origin !== baseOrigin) {
      return "external"
    }
  } catch {
    // Unknown origins may point at the application runtime and remain blocking.
  }
  return "blocking"
}
