/**
 * Who gets the voice assistant: the person whose «Голос» switch an admin
 * turned on in Settings → Users. That switch is the grant (owner, 2026-10-26:
 * «голос должен активироваться в разделе пользователи»). Until then an env
 * allowlist (VOICE_PILOT_ORG_ID / VOICE_PILOT_USER_IDS) sat in front of it and
 * named a single organisation, so in every other tenant the switch was on
 * screen, ticked, and did nothing — Zeytun Pharma's admin ticked it and still
 * had no microphone.
 *
 * Still fail-closed, because the gates this codebase already has are not:
 *
 *  - `orgHasModule` returns TRUE when the DB throws (api-auth.ts, "Fail-OPEN"),
 *    so a database blip would grant voice rather than deny it.
 *  - `getOrgModuleContext` swallows the same errors and then CACHES the empty
 *    result for 30s, so it is fail-closed only by accident of its defaults.
 *  - `requireAuth`'s own module gate is skipped entirely when the org-status
 *    query throws, and superadmin sessions never load an org context at all —
 *    so a superadmin passes any module check by default.
 *
 * Hence every read that fails denies, `hasModule` (pure) is used rather than
 * `orgHasModule` (fail-open), and the provider env stays the host-wide kill
 * switch.
 */
import { hasModule } from "@/lib/modules"
import { getOrgModuleContext } from "@/lib/api-auth"
import { readVoicePilotConfig, voiceWritesEnabled } from "./config"

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

  // Which roles MAY be granted. Voice reads the whole organisation aloud, so
  // the answer is the people who already see it on screen. Checked before the
  // per-user switch so a mis-ticked box on a viewer cannot open anything.
  if (!VOICE_ELIGIBLE_ROLES.has(auth.role)) {
    return { ok: false, reason: "voice_pilot_role_denied" }
  }

  // The switch, for every role — superadmin included. The row is looked up in
  // the organisation the session acts in, so a superadmin working inside
  // another tenant has no row there and gets no voice: their session can name
  // any organisation, and voice would read that tenant aloud. The switch is
  // written only by an admin of the organisation (PUT /api/v1/users/[id],
  // "settings"/"write"), never by its holder through preferences.
  let enabled = false
  try {
    // MUST run inside the tenant scope. RLS is fail-closed: the same query
    // without a context returns zero rows silently, so the flag would read as
    // false for everyone and voice would refuse every user without a single
    // error in the logs. The gate is called from routes that do not all open a
    // scope of their own (the access probe is a bare GET), so the scope is
    // opened here rather than left to each caller to remember.
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

/**
 * The gate every voice route that can end in a CRM mutation runs, on top of
 * the pilot gate rather than instead of it.
 *
 * It exists as one function for the same reason the pilot gate does: a check
 * that each route remembers to make is a check one route will eventually
 * forget. Routes that cannot mutate anything — reading the active receipt,
 * cancelling a draft — deliberately do NOT call it, so a draft prepared before
 * the switch was thrown can still be dismissed rather than being stuck on
 * screen with no way out.
 */
export async function checkVoiceWriteAccess(auth: {
  orgId: string
  userId: string
  role: string
}): Promise<VoiceGateResult> {
  const gate = await checkVoicePilotAccess(auth)
  if (!gate.ok) return gate
  if (!voiceWritesEnabled()) return { ok: false, reason: "voice_writes_disabled" }
  return { ok: true }
}
