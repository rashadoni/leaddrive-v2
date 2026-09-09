/**
 * CDP fuzzy duplicate-scan — slice-3 wiring tests.
 *
 * `scanFuzzyDuplicatesForOrg` is the piece that finally makes the
 * /cdp/merge-queue screen do what its copy promises: a sweep over the
 * tenant's UnifiedProfiles that surfaces *similar* (not just exact-collision)
 * duplicates into the operator queue.
 *
 * Locked contract:
 *   • near-dup pair (score >= manualReview) → one `pending` candidate row
 *   • below-threshold pair → no row
 *   • SAFETY: even an auto-tier (score >= autoMerge) fuzzy pair is queued as
 *     `pending`, NEVER auto-merged — a fuzzy match must not silently delete a
 *     customer profile
 *   • idempotent / no-resurrection: a pair that already has a candidate in ANY
 *     status (incl. `rejected`) is skipped — the scan must not re-nag the
 *     operator about a pair they already judged
 *   • tenant-scoped reads
 *   • P2002 (pending partial-unique race) is swallowed, not fatal
 *   • a profile cap bounds the O(n²) sweep and reports truncation (no silent cap)
 */
import { describe, expect, it, vi } from "vitest"
import {
  scanFuzzyDuplicatesForOrg,
  type FuzzyScanClient,
} from "@/lib/identity-resolution/fuzzy-duplicate-scan"

const ORG = "org-1"

interface ProfileRow {
  id: string
  emailNormalized: string | null
  phoneNormalized: string | null
  nameNormalized: string | null
}

function p(
  id: string,
  emailNormalized: string | null,
  phoneNormalized: string | null,
  nameNormalized: string | null,
): ProfileRow {
  return { id, emailNormalized, phoneNormalized, nameNormalized }
}

function makeClient(
  profiles: ProfileRow[],
  existing: Array<{ primaryProfileId: string; secondaryProfileId: string }> = [],
  createImpl?: (args: { data: Record<string, unknown> }) => Promise<unknown>,
) {
  const created: Array<Record<string, unknown>> = []
  const findManyProfiles = vi.fn(async (args: { take?: number }) => {
    const take = args?.take
    return typeof take === "number" ? profiles.slice(0, take) : profiles
  })
  const findManyCandidates = vi.fn(async (_args: { where?: unknown; select?: unknown }) => existing)
  const create =
    createImpl ??
    vi.fn(async (args: { data: Record<string, unknown> }) => {
      created.push(args.data)
      return { id: `cand-${created.length}`, ...args.data }
    })
  const client: FuzzyScanClient = {
    unifiedProfile: { findMany: findManyProfiles },
    profileMergeCandidate: { findMany: findManyCandidates, create },
  }
  return { client, created, findManyProfiles, findManyCandidates, create }
}

// Same email domain + tiny local-part edit + same phone + same name → ~0.85
// (manual-review band).
const NEAR_A = p("aaa", "ali@acme.com", "+994501112233", "ali mammadov")
const NEAR_B = p("bbb", "alii@acme.com", "+994501112233", "ali mammadov")
// Different domain, different phone, different name → well below 0.7.
const FAR_C = p("ccc", "zzz@different.org", "+10000000000", "john smith")

describe("scanFuzzyDuplicatesForOrg", () => {
  it("opens one pending candidate for a near-duplicate pair", async () => {
    const { client, created } = makeClient([NEAR_A, NEAR_B])
    const res = await scanFuzzyDuplicatesForOrg(client, ORG)

    expect(created).toHaveLength(1)
    const c = created[0]
    expect(c.organizationId).toBe(ORG)
    expect(c.status).toBe("pending")
    // canonical: lexicographically-smaller id is primary
    expect(c.primaryProfileId).toBe("aaa")
    expect(c.secondaryProfileId).toBe("bbb")
    expect(c.score as number).toBeGreaterThanOrEqual(0.7)
    expect(c.score as number).toBeLessThan(0.95)
    expect(c.matchBreakdown).toMatchObject({ email: expect.any(Number), phone: 1, name: 1 })
    expect(res.candidatesCreated).toBe(1)
    expect(res.profilesScanned).toBe(2)
    expect(res.comparisons).toBe(1)
  })

  it("does NOT open a candidate for a below-threshold pair", async () => {
    const { client, created } = makeClient([NEAR_A, FAR_C])
    const res = await scanFuzzyDuplicatesForOrg(client, ORG)
    expect(created).toHaveLength(0)
    expect(res.candidatesCreated).toBe(0)
  })

  it("queues an auto-tier (>=0.95) fuzzy pair as pending — never auto-merges", async () => {
    // Identical normalized identity → score 1.0. Real profiles can't share the
    // unique keys, but the scan must still refuse to auto-delete on a fuzzy hit.
    const a = p("aaa", "ali@acme.com", "+994501112233", "ali mammadov")
    const b = p("bbb", "ali@acme.com", "+994501112233", "ali mammadov")
    const { client, created } = makeClient([a, b])
    await scanFuzzyDuplicatesForOrg(client, ORG)
    expect(created).toHaveLength(1)
    expect(created[0].score as number).toBeGreaterThanOrEqual(0.95)
    expect(created[0].status).toBe("pending")
    expect(String(created[0].reason)).toContain("auto-merge disabled")
  })

  it("skips a pair that already has a candidate in ANY status (no resurrection)", async () => {
    // Operator already rejected aaa↔bbb — the nightly scan must not re-open it.
    const { client, created } = makeClient(
      [NEAR_A, NEAR_B],
      [{ primaryProfileId: "aaa", secondaryProfileId: "bbb" }],
    )
    const res = await scanFuzzyDuplicatesForOrg(client, ORG)
    expect(created).toHaveLength(0)
    expect(res.skippedExisting).toBe(1)
  })

  it("reads are scoped to the tenant", async () => {
    const { client, findManyProfiles, findManyCandidates } = makeClient([NEAR_A, NEAR_B])
    await scanFuzzyDuplicatesForOrg(client, ORG)
    expect(findManyProfiles.mock.calls[0][0]).toMatchObject({ where: { organizationId: ORG } })
    expect(findManyCandidates.mock.calls[0][0]).toMatchObject({ where: { organizationId: ORG } })
  })

  it("swallows a P2002 pending-pair race instead of failing the sweep", async () => {
    const create = vi.fn(async () => {
      throw Object.assign(new Error("unique"), { code: "P2002" })
    })
    const { client } = makeClient([NEAR_A, NEAR_B], [], create)
    const res = await scanFuzzyDuplicatesForOrg(client, ORG)
    expect(res.candidatesCreated).toBe(0)
    expect(res.skippedExisting).toBe(1)
  })

  it("caps the sweep and reports truncation (no silent cap)", async () => {
    const profiles = [NEAR_A, NEAR_B, p("ddd", "x@x.com", "+1", "x")]
    const { client, findManyProfiles } = makeClient(profiles)
    const res = await scanFuzzyDuplicatesForOrg(client, ORG, { maxProfiles: 2 })
    expect(res.truncated).toBe(true)
    expect(res.profilesScanned).toBe(2)
    // fetched cap + 1 to detect overflow
    expect(findManyProfiles.mock.calls[0][0]).toMatchObject({ take: 3 })
  })
})
