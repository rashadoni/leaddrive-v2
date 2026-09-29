export interface PortalContactRecord {
  id: string
  fullName: string
  email: string | null
  phone: string | null
  companyName: string | null
  isActive: boolean
  portalAccessEnabled: boolean
  hasPassword: boolean
  portalLastLoginAt: string | null
  recoveryExpiresAt: string | null
}

export type PortalAccessState = "contact_inactive" | "disabled" | "setup_pending" | "registered" | "recovery_active" | "recovery_expired"

export function portalAccessState(contact: PortalContactRecord, now = Date.now()): PortalAccessState {
  if (!contact.isActive) return "contact_inactive"
  if (!contact.portalAccessEnabled) return "disabled"
  if (contact.recoveryExpiresAt) {
    const expiry = new Date(contact.recoveryExpiresAt).getTime()
    if (Number.isFinite(expiry) && expiry > now) return "recovery_active"
    if (Number.isFinite(expiry) && expiry <= now) return "recovery_expired"
  }
  return contact.hasPassword ? "registered" : "setup_pending"
}

export function visibleSelection(selected: ReadonlySet<string>, contacts: readonly PortalContactRecord[]): Set<string> {
  const visibleIds = new Set(contacts.map((contact) => contact.id))
  return new Set([...selected].filter((id) => visibleIds.has(id)))
}

export function togglePortalSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function selectAllVisible(contacts: readonly PortalContactRecord[]): Set<string> {
  return new Set(contacts.map((contact) => contact.id))
}
