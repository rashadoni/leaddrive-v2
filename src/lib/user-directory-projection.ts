/**
 * Explicit projections for organization user-directory endpoints.
 *
 * A roster reader needs identity and assignment fields, not a colleague's
 * authentication posture. Keep the list and single-user endpoints on these
 * shared allow-lists so a future field added to one route cannot silently
 * reintroduce excessive disclosure on the other.
 */
export const USER_ROSTER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  department: true,
  isActive: true,
  isAvailable: true,
} as const

export const USER_ADMIN_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  department: true,
  isActive: true,
  totpEnabled: true,
  require2fa: true,
  voiceEnabled: true,
  smsAuthEnabled: true,
  verifiedPhone: true,
  lastLogin: true,
  passwordChangedAt: true,
  loginCount: true,
  skills: true,
  maxTickets: true,
  isAvailable: true,
  preferredLanguage: true,
  createdAt: true,
  updatedAt: true,
} as const
