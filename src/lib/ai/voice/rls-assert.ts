/**
 * Refuse to mint a voice session unless the voice tables actually carry their
 * RLS policy ON THIS DATABASE.
 *
 * A migration present in the repo is not proof the policy exists in production:
 * `prisma migrate resolve --applied` can mark a migration done without running
 * it, and this repo has a documented history of exactly that drift (see
 * CLAUDE.md, "RLS: репо ≠ прод"). Because RLS is fail-closed, a MISSING policy
 * is silent — queries just return nothing — but a missing policy on a table we
 * then query by explicit organizationId would be a real cross-tenant hole if any
 * caller ever forgot that predicate.
 *
 * Checked once per process, not per request: pg_policies is cheap but this sits
 * on the hot path of starting a conversation.
 */
import { prisma } from "@/lib/prisma"
import { runWithRlsBypass } from "@/lib/rls-context"

const VOICE_TABLES = ["voice_sessions", "voice_session_turns", "voice_monthly_usage"] as const

let cached: Promise<void> | null = null

async function probe(): Promise<void> {
  // pg_policies is a catalog view, not a tenant table — read it outside any
  // tenant scope so a missing app.org_id cannot make the probe self-fulfilling.
  const rows = await runWithRlsBypass(() =>
    prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_policies
      WHERE policyname = 'tenant_isolation'
        AND tablename IN ('voice_sessions', 'voice_session_turns', 'voice_monthly_usage')
    `,
  )
  const found = new Set(rows.map((r: { tablename: string }) => r.tablename))
  const missing = VOICE_TABLES.filter((t) => !found.has(t))
  if (missing.length > 0) {
    throw new Error(
      `[voice] refusing to start: tenant_isolation policy missing on ${missing.join(", ")}. ` +
        "The voice migration is present in the repo but not applied to this database.",
    )
  }
}

export async function assertVoiceRlsPolicies(): Promise<void> {
  // Deliberately NOT gated on NODE_ENV. The vault's fail-closed throw only
  // fires in production, which would make this a no-op in CI — and CI is
  // exactly where a forgotten policy should surface first.
  if (!cached) {
    cached = probe().catch((err) => {
      cached = null // let a later request retry rather than pinning the failure
      throw err
    })
  }
  return cached
}

/** Test seam — the process-level cache would otherwise leak between cases. */
export function __resetVoiceRlsProbe(): void {
  cached = null
}
