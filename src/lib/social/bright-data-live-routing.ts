export function isBrightDataLiveRoutingAllowed(
  organizationId: string,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  if (environment.SOCIAL_BRIGHT_DATA_LIVE_ROUTING !== "1") return false
  const configured = environment.SOCIAL_BRIGHT_DATA_LIVE_TENANT_IDS
  if (!configured?.trim()) return true
  const allowed = new Set(configured.split(",").map(value => value.trim()).filter(Boolean))
  return allowed.has(organizationId)
}
