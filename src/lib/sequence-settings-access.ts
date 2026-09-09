/**
 * Who may manage org-level sequence settings (E4 daily send limit + E6
 * single-active-enrollment policy). Single source of truth shared by the
 * settings PATCH route AND the touch-queue UI, so the client affordance and the
 * server gate never drift (a UI-shows-but-API-403s mismatch).
 *
 * Everyone on the sales floor can manage these; only the read-only `viewer`
 * role is excluded. Widened from admin/manager on 2026-07-19 (owner request).
 */
export const SEQUENCE_SETTINGS_ROLES = ["admin", "manager", "sales", "support"] as const

export function canManageSequenceSettings(role: string | null | undefined): boolean {
  return !!role && (SEQUENCE_SETTINGS_ROLES as readonly string[]).includes(role)
}
