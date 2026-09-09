/**
 * Merge-queue resolution (Wave 2A) — resolver tests against a stateful fake
 * client. Covers merge (re-point sources → primary, fill primary's missing
 * identity keys, delete secondary, candidate cascade-removed), reject (status
 * persisted, both profiles kept), not-found, and already-resolved.
 */
import { describe, expect, it } from "vitest"
import {
  resolveMergeCandidate,
  type MergeResolverClient,
} from "@/lib/unified-profile/merge-candidate-resolver"

const ORG = "org-1"
const NOW = new Date("2026-06-01T00:00:00.000Z")

interface Profile {
  id: string
  organizationId: string
  emailNormalized: string | null
  phoneNormalized: string | null
  nameNormalized: string | null
  displayEmail: string | null
  displayPhone: string | null
  displayName: string | null
  primaryContactId: string | null
  primaryCompanyId: string | null
}
interface Candidate {
  id: string
  organizationId: string
  primaryProfileId: string
  secondaryProfileId: string
  status: string
  reviewedBy?: string | null
  reviewedAt?: Date | null
  reviewNote?: string | null
}
interface Source {
  organizationId: string
  unifiedProfileId: string
  sourceType: string
  sourceId: string
}

function makeClient(seed: { profiles?: Profile[]; candidates?: Candidate[]; sources?: Source[] } = {}) {
  const profiles = seed.profiles ?? []
  const candidates = seed.candidates ?? []
  const sources = seed.sources ?? []

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const client: MergeResolverClient = {
    profileMergeCandidate: {
      findFirst: async ({ where }: any) =>
        candidates.find((c) => c.id === where.id && c.organizationId === where.organizationId) ?? null,
      updateMany: async ({ where, data }: any) => {
        let count = 0
        for (const c of candidates) {
          if (
            c.id === where.id &&
            c.organizationId === where.organizationId &&
            (where.status === undefined || c.status === where.status)
          ) {
            Object.assign(c, data)
            count++
          }
        }
        return { count }
      },
    },
    unifiedProfile: {
      findFirst: async ({ where }: any) =>
        profiles.find((p) => p.id === where.id && p.organizationId === where.organizationId) ?? null,
      delete: async ({ where }: any) => {
        const i = profiles.findIndex((p) => p.id === where.id)
        if (i >= 0) profiles.splice(i, 1)
        // simulate the secondaryProfile/primaryProfile onDelete: Cascade
        for (let j = candidates.length - 1; j >= 0; j--) {
          if (candidates[j].primaryProfileId === where.id || candidates[j].secondaryProfileId === where.id) {
            candidates.splice(j, 1)
          }
        }
        return {}
      },
      update: async ({ where, data }: any) => {
        const p = profiles.find((x) => x.id === where.id)
        if (p) Object.assign(p, data)
        return p
      },
    },
    profileSource: {
      updateMany: async ({ where, data }: any) => {
        let count = 0
        for (const s of sources) {
          if (s.organizationId === where.organizationId && s.unifiedProfileId === where.unifiedProfileId) {
            s.unifiedProfileId = data.unifiedProfileId
            count++
          }
        }
        return { count }
      },
    },
    $transaction: async (fn: any) => fn(client),
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { client, profiles, candidates, sources }
}

function profile(over: Partial<Profile> & { id: string }): Profile {
  return {
    organizationId: ORG,
    emailNormalized: null,
    phoneNormalized: null,
    nameNormalized: null,
    displayEmail: null,
    displayPhone: null,
    displayName: null,
    primaryContactId: null,
    primaryCompanyId: null,
    ...over,
  }
}

function seedAmbiguous() {
  // P1 = email-only (Alice via contact c1); P2 = phone-only (via contact c2).
  // Candidate cand1 links them (the classic email→A / phone→B ambiguity).
  return {
    profiles: [
      profile({ id: "P1", emailNormalized: "a@x.com", displayEmail: "a@x.com", displayName: "Alice", primaryContactId: "c1" }),
      profile({ id: "P2", phoneNormalized: "+994501112233", displayPhone: "+994501112233", primaryContactId: "c2" }),
    ],
    candidates: [
      { id: "cand1", organizationId: ORG, primaryProfileId: "P1", secondaryProfileId: "P2", status: "pending" },
    ],
    sources: [
      { organizationId: ORG, unifiedProfileId: "P1", sourceType: "contact", sourceId: "c1" },
      { organizationId: ORG, unifiedProfileId: "P2", sourceType: "contact", sourceId: "c2" },
    ],
  }
}

describe("resolveMergeCandidate", () => {
  it("merge: re-points secondary's sources → primary, fills primary's missing keys, deletes secondary", async () => {
    const { client, profiles, candidates, sources } = makeClient(seedAmbiguous())

    const res = await resolveMergeCandidate(client, {
      orgId: ORG,
      candidateId: "cand1",
      action: "merge",
      reviewedBy: "user-1",
      now: NOW,
    })

    expect(res.status).toBe("merged")
    expect(res.primaryProfileId).toBe("P1")
    expect(res.secondaryProfileId).toBe("P2")

    // secondary deleted
    expect(profiles.map((p) => p.id)).toEqual(["P1"])
    // primary now carries BOTH identity keys
    const p1 = profiles[0]
    expect(p1.emailNormalized).toBe("a@x.com")
    expect(p1.phoneNormalized).toBe("+994501112233") // adopted from secondary
    expect(p1.displayPhone).toBe("+994501112233")
    // all sources re-pointed to the primary
    expect(sources.every((s) => s.unifiedProfileId === "P1")).toBe(true)
    expect(sources).toHaveLength(2)
    // candidate cascade-removed with the secondary
    expect(candidates).toHaveLength(0)
  })

  it("reject: marks the candidate rejected with reviewer + note, keeps both profiles", async () => {
    const { client, profiles, candidates, sources } = makeClient(seedAmbiguous())

    const res = await resolveMergeCandidate(client, {
      orgId: ORG,
      candidateId: "cand1",
      action: "reject",
      reviewedBy: "user-1",
      reviewNote: "different people",
      now: NOW,
    })

    expect(res.status).toBe("rejected")
    expect(profiles).toHaveLength(2) // both kept
    expect(sources.every((s, i) => s.unifiedProfileId === (i === 0 ? "P1" : "P2"))).toBe(true) // untouched
    const c = candidates[0]
    expect(c.status).toBe("rejected")
    expect(c.reviewedBy).toBe("user-1")
    expect(c.reviewedAt).toEqual(NOW)
    expect(c.reviewNote).toBe("different people")
  })

  it("returns not_found for an unknown candidate id", async () => {
    const { client } = makeClient(seedAmbiguous())
    const res = await resolveMergeCandidate(client, {
      orgId: ORG,
      candidateId: "ghost",
      action: "merge",
      reviewedBy: "user-1",
      now: NOW,
    })
    expect(res.status).toBe("not_found")
  })

  it("returns already_resolved for a non-pending candidate (idempotent guard)", async () => {
    const seed = seedAmbiguous()
    seed.candidates[0].status = "rejected"
    const { client, profiles } = makeClient(seed)
    const res = await resolveMergeCandidate(client, {
      orgId: ORG,
      candidateId: "cand1",
      action: "merge",
      reviewedBy: "user-1",
      now: NOW,
    })
    expect(res.status).toBe("already_resolved")
    expect(profiles).toHaveLength(2) // nothing merged
  })
})
