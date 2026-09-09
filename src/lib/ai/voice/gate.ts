/**
 * The voice pilot gate. Fail-closed by construction, because the gates this
 * codebase already has are not:
 *
 *  - `orgHasModule` returns TRUE when the DB throws (api-auth.ts, "Fail-OPEN"),
 *    so a database blip would grant voice rather than deny it.
 *  - `getOrgModuleContext` swallows the same errors and then CACHES the empty
 *    result for 30s, so it is fail-closed only by accident of its defaults.
 *  - `requireAuth`'s own module gate is skipped entirely when the org-status
 *    query throws, and superadmin sessions never load an org context at all —
 *    so a superadmin passes any module check by default.
 *
 * Hence the env allowlist runs FIRST and unconditionally. `hasModule` is the
 * last of the four checks, not the first, and it is `hasModule` (pure) rather
 * than `orgHasModule` (fail-open).
 */
import { hasModule } from "@/lib/modules"
import { getOrgModuleContext } from "@/lib/api-auth"
import { readVoicePilotConfig } from "./config"

/**
 * Roles that may be granted voice at all. An admin ticking the box on a viewer
 * does not open anything — the role check runs first, deliberately, because a
 * mis-click is the likeliest way this gets loosened.
 */
const VOICE_ELIGIBLE_ROLES = new Set(["admin", "manager", "superadmin"])

import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/rls-context"

export type VoiceGateResult = { ok: true } | { ok: false; reason: string }

export async function checkVoicePilotAccess(auth: {
  orgId: string
  userId: string
  role: string
}): Promise<VoiceGateResult> {
  const cfg = readVoicePilotConfig()

  // Unconfigured means off. An empty org must never read as "everyone".
  if (!cfg.orgId) {
    return { ok: false, reason: "voice_pilot_not_configured" }
  }

  // Gate on the ORGANISATION, not just the user: a superadmin can act inside
  // any tenant, and without this their session would carry voice — and the
  // tenant's data — into the pilot org's voice session. This stays in
  // env while the pilot runs: it is the ceiling, and moving it into the DB
  // would put the ceiling in the same place as the grant.
  if (auth.orgId !== cfg.orgId) {
    return { ok: false, reason: "voice_pilot_org_not_enrolled" }
  }

  // Which roles MAY be granted. Voice reads the whole organisation aloud, so
  // the answer is the people who already see it on screen. Checked before the
  // per-user flag so a mis-ticked box on a viewer cannot open anything.
  if (!VOICE_ELIGIBLE_ROLES.has(auth.role)) {
    return { ok: false, reason: "voice_pilot_role_denied" }
  }

  // Superadmin bypasses the per-user flag — they are not a member of the
  // tenant and have no row an admin could tick.
  if (auth.role !== "superadmin") {
    // Env still wins while it is populated: it is the pilot kill-switch, and a
    // switch that a DB write can override is not a switch.
    if (cfg.userIds.length > 0 && !cfg.userIds.includes(auth.userId)) {
      return { ok: false, reason: "voice_pilot_user_not_enrolled" }
    }

    let enabled = false
    try {
      // MUST run inside the tenant scope. RLS is fail-closed: the same query
      // without a context returns zero rows silently, so the flag would read as
      // false for everyone and voice would refuse the whole pilot without a
      // single error in the logs. The gate is called from routes that do not
      // all open a scope of their own (the access probe is a bare GET), so the
      // scope is opened here rather than left to each caller to remember.
      const row = (await runWithTenant(auth.orgId, () =>
        prisma.user.findFirst({
          where: { id: auth.userId, organizationId: auth.orgId },
          select: { voiceEnabled: true },
        }),
      )) as { voiceEnabled: boolean } | null
      enabled = row?.voiceEnabled === true
    } catch {
      // A failed read denies. Same rule as the module lookup below: this gate
      // guards a paid third-party session over the org's data, so "we could not
      // check" must never resolve to "allowed".
      return { ok: false, reason: "voice_grant_check_failed" }
    }
    if (!enabled) {
      return { ok: false, reason: "voice_not_granted" }
    }
  }

  // Reads can still throw; treat any failure as denial rather than letting the
  // exception escape into a 500 that reveals nothing useful.
  try {
    const orgCtx = await getOrgModuleContext(auth.orgId)
    if (!hasModule(orgCtx, "ai")) {
      return { ok: false, reason: "module_ai_not_enabled" }
    }
  } catch {
    return { ok: false, reason: "module_check_failed" }
  }

  if (cfg.realtimeProvider !== "gemini_live") {
    return { ok: false, reason: "voice_provider_not_gemini_live" }
  }

  if (!cfg.geminiApiKey) {
    return { ok: false, reason: "voice_provider_not_configured" }
  }

  return { ok: true }
}
