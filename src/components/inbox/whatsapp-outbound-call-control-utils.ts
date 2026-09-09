export interface WhatsAppCallPermissionView {
  status: string
  canRequest: boolean
  canStartCall: boolean
  expiresAt?: string | null
  lastError?: string | null
}

export interface WhatsAppCallProviderView {
  success?: boolean
  permissionStatus?: string
  canRequest?: boolean
  canStartCall?: boolean
  error?: string | null
}

export interface PermissionPayload {
  permission?: WhatsAppCallPermissionView | null
  provider?: WhatsAppCallProviderView | null
}

export function canStartWhatsAppCall(permission: WhatsAppCallPermissionView | null | undefined): boolean {
  return permission?.canStartCall === true
}

export function canRequestWhatsAppCallPermission(permission: WhatsAppCallPermissionView | null | undefined): boolean {
  return permission?.canRequest === true
}

export function normalizeWhatsAppPermissionPayload(payload: PermissionPayload | null | undefined): {
  permission: WhatsAppCallPermissionView | null
  providerError: string | null
  hasPermissionPayload: boolean
  hasProviderPayload: boolean
} {
  const hasPermissionPayload = !!payload && Object.prototype.hasOwnProperty.call(payload, "permission")
  const hasProviderPayload = !!payload && Object.prototype.hasOwnProperty.call(payload, "provider")
  const permission = payload?.permission ?? null
  const providerError = payload?.provider?.error || permission?.lastError || null

  return {
    permission,
    providerError,
    hasPermissionPayload,
    hasProviderPayload,
  }
}

export function whatsAppCallBlockedReason(
  permission: WhatsAppCallPermissionView | null | undefined,
  providerError: string | null | undefined,
  fallback: string,
): string | null {
  if (canStartWhatsAppCall(permission) || canRequestWhatsAppCallPermission(permission)) return null
  return providerError || permission?.lastError || fallback
}
