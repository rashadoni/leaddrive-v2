/** Server-written marker; never accept this from a PBX/model request body. */
export function isPharmacyInboundPreview(audit: unknown, providerCallId: string): boolean {
  if (!audit || typeof audit !== "object" || !("pharmacyInboundPreview" in audit)) return false
  const marker = audit.pharmacyInboundPreview
  return Boolean(marker && typeof marker === "object" && "version" in marker && marker.version === 1 &&
    "providerCallId" in marker && marker.providerCallId === providerCallId &&
    "grantId" in marker && typeof marker.grantId === "string" && marker.grantId.length > 0)
}
