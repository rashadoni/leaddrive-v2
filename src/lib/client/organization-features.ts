function featureHeaders(organizationId?: string, json = false): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(organizationId ? { "x-organization-id": organizationId } : {}),
  }
}

function readFeatureList(body: unknown): string[] {
  const value = body as { data?: { features?: unknown } }
  return Array.isArray(value?.data?.features)
    ? value.data.features.filter((feature): feature is string => typeof feature === "string")
    : []
}

/** Browser adapter shared by Omnichannel and module-level AI switches. */
export async function loadOrganizationFeatures(organizationId?: string): Promise<string[]> {
  const response = await fetch("/api/v1/settings/ai-features", {
    headers: featureHeaders(organizationId),
    cache: "no-store",
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  return readFeatureList(body)
}
/** Uses the existing audited, atomic feature PATCH used by Omnichannel. */
export async function updateOrganizationFeature(
  feature: string,
  enabled: boolean,
  organizationId?: string,
): Promise<string[]> {
  const response = await fetch("/api/v1/settings/ai-features", {
    method: "PATCH",
    headers: featureHeaders(organizationId, true),
    body: JSON.stringify({ feature, action: enabled ? "add" : "remove" }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  return readFeatureList(body)
}
