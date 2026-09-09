/**
 * CDP UnifiedProfile builder — slice-2 write-path tests.
 *
 * Exercises buildProfilesForOrg() against a stateful in-memory fake client
 * (no DB). Covers the four merge decisions, paid-invoice aggregation,
 * channel tagging, and — critically — idempotency (a re-run must not
 * duplicate profiles / sources / merge candidates).
 */
import { describe, expect, it } from "vitest"
import {
  buildProfilesForOrg,
  refreshProfileForSource,
  type ProfileBuilderClient,
} from "@/lib/unified-profile/profile-builder"

const ORG = "org-1"
const NOW = new Date("2026-06-01T00:00:00.000Z")

/* ─── Stateful fake client ─────────────────────────────────────────────── */

interface Contact {
  id: string
  organizationId: string
  fullName: string | null
  email: string | null
  phone: string | null
  companyId: string | null
  createdAt: Date
  updatedAt: Date
}
interface Invoice {
  id: string
  organizationId: string
  contactId: string | null
  companyId: string | null
  totalAmount: number
  currency: string
  status: string
  paidAt: Date | null
}
interface Lead {
  id: string
  organizationId: string
  contactName: string | null
  email: string | null
  phone: string | null
  createdAt: Date
  updatedAt: Date
}
interface MtmCustomer {
  id: string
  organizationId: string
  name: string | null
  phone: string | null
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
interface WebChatSession {
  id: string
  organizationId: string
  visitorName: string | null
  visitorEmail: string | null
  visitorPhone: string | null
  contactId: string | null
  createdAt: Date
  lastMessageAt: Date
}
interface ProfileRow {
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
  primaryCurrency: string | null
  totalSpent: number
  lifetimeOrderCount: number
  firstSeenAt: Date | null
  lastSeenAt: Date | null
  channelsActive: string[]
  metadata: unknown
  lastRefreshedAt: Date | null
}
interface SourceRow {
  organizationId: string
  unifiedProfileId: string
  sourceType: string
  sourceId: string
  confidence: number
  lastContributedAt: Date
}
interface CandidateRow {
  id: string
  organizationId: string
  primaryProfileId: string
  secondaryProfileId: string
  score: number
  reason: string | null
  status: string
}

function makeClient(seed: {
  contacts?: Contact[]
  leads?: Lead[]
  mtmCustomers?: MtmCustomer[]
  webChatSessions?: WebChatSession[]
  invoices?: Invoice[]
} = {}) {
  const contacts = seed.contacts ?? []
  const leads = seed.leads ?? []
  const mtmCustomers = seed.mtmCustomers ?? []
  const webChatSessions = seed.webChatSessions ?? []
  const invoices = seed.invoices ?? []
  const profiles: ProfileRow[] = []
  const sources: SourceRow[] = []
  const candidates: CandidateRow[] = []
  let pSeq = 0
  let cSeq = 0

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // Match Prisma `where.id` — either an exact string or `{ in: [...] }`.
  const idMatches = (rowId: string, whereId: any): boolean => {
    if (whereId === undefined) return true
    if (typeof whereId === "string") return rowId === whereId
    if (whereId?.in) return whereId.in.includes(rowId)
    return true
  }
  const sortTake = <T extends { id: string }>(rows: T[], orderBy: any, take?: number): T[] => {
    let out = orderBy?.id === "asc" ? [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : rows
    if (typeof take === "number") out = out.slice(0, take)
    return out
  }
  const client: ProfileBuilderClient = {
    contact: {
      findMany: async ({ where, orderBy, take }: any) =>
        sortTake(contacts.filter((c) => c.organizationId === where.organizationId && idMatches(c.id, where.id)), orderBy, take),
    },
    lead: {
      findMany: async ({ where, orderBy, take }: any) =>
        sortTake(leads.filter((l) => l.organizationId === where.organizationId && idMatches(l.id, where.id)), orderBy, take),
    },
    mtmCustomer: {
      findMany: async ({ where, orderBy, take }: any) =>
        sortTake(
          mtmCustomers.filter(
            (m) => m.organizationId === where.organizationId && idMatches(m.id, where.id) && (where.deletedAt === null ? m.deletedAt === null : true),
          ),
          orderBy,
          take,
        ),
    },
    webChatSession: {
      findMany: async ({ where, orderBy, take }: any) =>
        sortTake(webChatSessions.filter((w) => w.organizationId === where.organizationId && idMatches(w.id, where.id)), orderBy, take),
    },
    invoice: {
      findMany: async ({ where }: any) =>
        invoices.filter((inv) => {
          if (where.organizationId && inv.organizationId !== where.organizationId) return false
          if (where.status && inv.status !== where.status) return false
          if (where.paidAt?.not === null && inv.paidAt == null) return false
          if (where.OR) {
            const ok = where.OR.some((cond: any) => {
              if (cond.contactId?.in) return inv.contactId != null && cond.contactId.in.includes(inv.contactId)
              if (cond.companyId?.in) return inv.companyId != null && cond.companyId.in.includes(inv.companyId)
              return false
            })
            if (!ok) return false
          }
          return true
        }),
    },
    unifiedProfile: {
      findMany: async ({ where, orderBy }: any) => {
        const rows = sortTake(
          profiles.filter((p) => p.organizationId === where.organizationId && idMatches(p.id, where.id)),
          orderBy,
        )
        // attach computed `sources` relation (Phase B select asks for it)
        return rows.map((p) => ({
          ...p,
          sources: sources
            .filter((s) => s.unifiedProfileId === p.id)
            .map((s) => ({ sourceType: s.sourceType, sourceId: s.sourceId })),
        }))
      },
      create: async ({ data }: any) => {
        const id = `prof_${++pSeq}`
        profiles.push({
          id,
          organizationId: data.organizationId,
          emailNormalized: data.emailNormalized ?? null,
          phoneNormalized: data.phoneNormalized ?? null,
          nameNormalized: data.nameNormalized ?? null,
          displayEmail: data.displayEmail ?? null,
          displayPhone: data.displayPhone ?? null,
          displayName: data.displayName ?? null,
          primaryContactId: data.primaryContactId ?? null,
          primaryCompanyId: data.primaryCompanyId ?? null,
          primaryCurrency: data.primaryCurrency ?? null,
          totalSpent: 0,
          lifetimeOrderCount: 0,
          firstSeenAt: null,
          lastSeenAt: null,
          channelsActive: [],
          metadata: {},
          lastRefreshedAt: null,
        })
        return { id }
      },
      update: async ({ where, data }: any) => {
        const p = profiles.find((row) => row.id === where.id)
        if (!p) throw new Error(`update: profile ${where.id} not found`)
        Object.assign(p, data)
        return p
      },
    },
    profileSource: {
      upsert: async ({ where, create, update }: any) => {
        const key = where.organizationId_sourceType_sourceId
        const existing = sources.find(
          (s) =>
            s.organizationId === key.organizationId &&
            s.sourceType === key.sourceType &&
            s.sourceId === key.sourceId,
        )
        if (existing) {
          Object.assign(existing, update)
          return existing
        }
        const row: SourceRow = { ...create }
        sources.push(row)
        return row
      },
    },
    profileMergeCandidate: {
      findFirst: async ({ where }: any) =>
        candidates.find(
          (c) =>
            c.organizationId === where.organizationId &&
            c.primaryProfileId === where.primaryProfileId &&
            c.secondaryProfileId === where.secondaryProfileId &&
            c.status === where.status,
        ) ?? null,
      create: async ({ data }: any) => {
        const row: CandidateRow = { id: `cand_${++cSeq}`, ...data }
        candidates.push(row)
        return row
      },
    },
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return { client, profiles, sources, candidates }
}

function contact(over: Partial<Contact> & { id: string }): Contact {
  return {
    organizationId: ORG,
    fullName: null,
    email: null,
    phone: null,
    companyId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    ...over,
  }
}

function lead(over: Partial<Lead> & { id: string }): Lead {
  return {
    organizationId: ORG,
    contactName: null,
    email: null,
    phone: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    ...over,
  }
}

function mtmCustomer(over: Partial<MtmCustomer> & { id: string }): MtmCustomer {
  return {
    organizationId: ORG,
    name: null,
    phone: null,
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    ...over,
  }
}

function webChatSession(over: Partial<WebChatSession> & { id: string }): WebChatSession {
  return {
    organizationId: ORG,
    visitorName: null,
    visitorEmail: null,
    visitorPhone: null,
    contactId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    lastMessageAt: new Date("2026-05-01T00:00:00.000Z"),
    ...over,
  }
}

/* ─── Tests ────────────────────────────────────────────────────────────── */

describe("buildProfilesForOrg — create / merge / ambiguous / reject", () => {
  it("creates a new profile from a contact with email + phone + name", async () => {
    const { client, profiles, sources } = makeClient({
      contacts: [contact({ id: "c1", fullName: "Ada Lovelace", email: "Ada@Example.com", phone: "+994501112233" })],
    })
    const res = await buildProfilesForOrg(client, ORG, { now: NOW })

    expect(res.profilesCreated).toBe(1)
    expect(res.sourcesLinked).toBe(1)
    expect(res.rejected).toBe(0)
    expect(profiles).toHaveLength(1)
    const p = profiles[0]
    expect(p.emailNormalized).toBe("ada@example.com") // lowercased
    expect(p.phoneNormalized).toBe("+994501112233")
    expect(p.displayEmail).toBe("Ada@Example.com") // display preserved
    expect(p.displayName).toBe("Ada Lovelace")
    expect(p.primaryContactId).toBe("c1")
    expect(p.channelsActive).toEqual(["contact"])
    expect(sources).toHaveLength(1)
    expect(sources[0].sourceType).toBe("contact")
    expect(sources[0].unifiedProfileId).toBe(p.id)
  })

  it("rejects a contact with neither email nor phone", async () => {
    const { client, profiles } = makeClient({
      contacts: [contact({ id: "c1", fullName: "No Identity" })],
    })
    const res = await buildProfilesForOrg(client, ORG, { now: NOW })
    expect(res.rejected).toBe(1)
    expect(res.profilesCreated).toBe(0)
    expect(profiles).toHaveLength(0)
  })

  it("merges two contacts sharing an email into ONE profile", async () => {
    const { client, profiles, sources } = makeClient({
      contacts: [
        contact({ id: "c1", email: "same@x.com", phone: "+994500000001" }),
        contact({ id: "c2", email: "same@x.com", phone: "+994500000002" }),
      ],
    })
    const res = await buildProfilesForOrg(client, ORG, { now: NOW })
    expect(res.profilesCreated).toBe(1) // second merges into first
    expect(profiles).toHaveLength(1)
    expect(sources).toHaveLength(2) // both contacts attached
    expect(sources.every((s) => s.unifiedProfileId === profiles[0].id)).toBe(true)
  })

  it("merges two contacts sharing a phone into ONE profile", async () => {
    const { client, profiles } = makeClient({
      contacts: [
        contact({ id: "c1", phone: "+994500000009" }),
        contact({ id: "c2", phone: "+994500000009" }),
      ],
    })
    const res = await buildProfilesForOrg(client, ORG, { now: NOW })
    expect(res.profilesCreated).toBe(1)
    expect(profiles).toHaveLength(1)
  })

  it("records a merge candidate when email→A and phone→B (ambiguous)", async () => {
    const { client, profiles, candidates, sources } = makeClient({
      contacts: [
        contact({ id: "cA", email: "a@x.com" }), // → profile A (email only)
        contact({ id: "cB", phone: "+994500000001" }), // → profile B (phone only)
        contact({ id: "cC", email: "a@x.com", phone: "+994500000001" }), // email→A, phone→B
      ],
    })
    const res = await buildProfilesForOrg(client, ORG, { now: NOW })
    expect(res.profilesCreated).toBe(2)
    expect(res.mergeCandidates).toBe(1)
    expect(profiles).toHaveLength(2)
    expect(candidates).toHaveLength(1)
    const cand = candidates[0]
    // primary = lexicographically-smaller profile id
    expect(cand.primaryProfileId < cand.secondaryProfileId).toBe(true)
    expect(cand.status).toBe("pending")
    // ambiguous source attaches to the primary so it still aggregates
    const cCsource = sources.find((s) => s.sourceId === "cC")
    expect(cCsource?.unifiedProfileId).toBe(cand.primaryProfileId)
  })

  it("records the ambiguous candidate regardless of contact read order (determinism)", async () => {
    // Same ambiguous scenario, but seed contacts in REVERSE. The builder's
    // orderBy:{id:asc} must still resolve cA/cB into profiles before cC, so the
    // candidate is recorded. Without the explicit sort this flips to 3 merges
    // into 1 profile + 0 candidates — a different result for identical data.
    const { client, profiles, candidates } = makeClient({
      contacts: [
        contact({ id: "cC", email: "a@x.com", phone: "+994500000001" }),
        contact({ id: "cB", phone: "+994500000001" }),
        contact({ id: "cA", email: "a@x.com" }),
      ],
    })
    const res = await buildProfilesForOrg(client, ORG, { now: NOW })
    expect(res.profilesCreated).toBe(2)
    expect(res.mergeCandidates).toBe(1)
    expect(profiles).toHaveLength(2)
    expect(candidates).toHaveLength(1)
  })
})

describe("buildProfilesForOrg — aggregation", () => {
  it("sums paid invoices into totalSpent + lifetimeOrderCount", async () => {
    const { client, profiles } = makeClient({
      contacts: [contact({ id: "c1", email: "buyer@x.com" })],
      invoices: [
        { id: "i1", organizationId: ORG, contactId: "c1", companyId: null, totalAmount: 100, currency: "AZN", status: "paid", paidAt: new Date("2026-02-01") },
        { id: "i2", organizationId: ORG, contactId: "c1", companyId: null, totalAmount: 250, currency: "AZN", status: "paid", paidAt: new Date("2026-03-01") },
        { id: "i3", organizationId: ORG, contactId: "c1", companyId: null, totalAmount: 999, currency: "AZN", status: "draft", paidAt: null }, // unpaid — excluded
      ],
    })
    await buildProfilesForOrg(client, ORG, { now: NOW })
    const p = profiles[0]
    expect(p.totalSpent).toBe(350)
    expect(p.lifetimeOrderCount).toBe(2)
    expect(p.primaryCurrency).toBe("AZN")
    expect(p.lastRefreshedAt).toEqual(NOW)
  })

  it("keeps non-primary currency invoices out of totalSpent (cross-currency)", async () => {
    const { client, profiles } = makeClient({
      contacts: [contact({ id: "c1", email: "intl@x.com" })],
      invoices: [
        { id: "i1", organizationId: ORG, contactId: "c1", companyId: null, totalAmount: 1000, currency: "AZN", status: "paid", paidAt: new Date("2026-02-01") },
        { id: "i2", organizationId: ORG, contactId: "c1", companyId: null, totalAmount: 50, currency: "USD", status: "paid", paidAt: new Date("2026-03-01") },
      ],
    })
    await buildProfilesForOrg(client, ORG, { now: NOW })
    const p = profiles[0]
    expect(p.primaryCurrency).toBe("AZN") // dominant by spend
    expect(p.totalSpent).toBe(1000) // only AZN
    expect(p.lifetimeOrderCount).toBe(2) // both orders count
    expect((p.metadata as { crossCurrencyTotals: Record<string, number> }).crossCurrencyTotals).toEqual({ USD: 50 })
  })
})

describe("buildProfilesForOrg — idempotency", () => {
  it("a second run creates no duplicate profiles / sources / candidates", async () => {
    const seed = {
      contacts: [
        contact({ id: "cA", email: "a@x.com" }),
        contact({ id: "cB", phone: "+994500000001" }),
        contact({ id: "cC", email: "a@x.com", phone: "+994500000001" }),
        contact({ id: "cD", email: "solo@x.com" }),
      ],
      invoices: [
        { id: "i1", organizationId: ORG, contactId: "cD", companyId: null, totalAmount: 75, currency: "AZN", status: "paid", paidAt: new Date("2026-02-01") },
      ],
    }
    const { client, profiles, sources, candidates } = makeClient(seed)

    const first = await buildProfilesForOrg(client, ORG, { now: NOW })
    const profilesAfter1 = profiles.length
    const sourcesAfter1 = sources.length
    const candsAfter1 = candidates.length

    const second = await buildProfilesForOrg(client, ORG, { now: NOW })

    expect(profiles.length).toBe(profilesAfter1) // no new profiles
    expect(sources.length).toBe(sourcesAfter1) // upserts, not inserts
    expect(candidates.length).toBe(candsAfter1) // find-then-create dedupes
    expect(second.profilesCreated).toBe(0)
    expect(second.mergeCandidates).toBe(0)
    // first run did create them
    expect(first.profilesCreated).toBeGreaterThan(0)
  })
})

describe("buildProfilesForOrg — slice-2 sources", () => {
  it("creates a profile from a Lead (contactName + email)", async () => {
    const { client, profiles } = makeClient({
      leads: [lead({ id: "l1", contactName: "Lead Person", email: "lead@x.com" })],
    })
    const res = await buildProfilesForOrg(client, ORG, { now: NOW })
    expect(res.profilesCreated).toBe(1)
    expect(profiles[0].channelsActive).toEqual(["lead"])
    expect(profiles[0].displayName).toBe("Lead Person")
  })

  it("creates a phone-only profile from an MtmCustomer and skips soft-deleted", async () => {
    const { client, profiles } = makeClient({
      mtmCustomers: [
        mtmCustomer({ id: "m1", name: "Shop A", phone: "+994551234567" }),
        mtmCustomer({ id: "m2", name: "Closed Shop", phone: "+994559999999", deletedAt: new Date("2026-04-01") }),
      ],
    })
    const res = await buildProfilesForOrg(client, ORG, { now: NOW })
    expect(res.profilesCreated).toBe(1) // soft-deleted m2 skipped
    expect(profiles[0].phoneNormalized).toBe("+994551234567")
    expect(profiles[0].emailNormalized).toBeNull() // MtmCustomer has no email
    expect(profiles[0].channelsActive).toEqual(["mtm_customer"])
  })

  it("creates a profile from a WebChatSession visitor", async () => {
    const { client, profiles } = makeClient({
      webChatSessions: [webChatSession({ id: "w1", visitorEmail: "visitor@x.com", visitorName: "Web Visitor" })],
    })
    const res = await buildProfilesForOrg(client, ORG, { now: NOW })
    expect(res.profilesCreated).toBe(1)
    expect(profiles[0].channelsActive).toEqual(["web_chat_session"])
  })

  it("does NOT let a web-chat session's linked contactId steal that contact's invoices", async () => {
    // Contact cX (email a@x) has a paid invoice. A web-chat session links to cX
    // but the visitor used a DIFFERENT email (b@y) → a separate profile. cX's
    // invoice must aggregate to cX's profile, never the web-chat visitor's.
    const { client, profiles } = makeClient({
      contacts: [contact({ id: "cX", email: "a@x.com" })],
      webChatSessions: [webChatSession({ id: "w1", visitorEmail: "b@y.com", contactId: "cX" })],
      invoices: [
        { id: "i1", organizationId: ORG, contactId: "cX", companyId: null, totalAmount: 500, currency: "AZN", status: "paid", paidAt: new Date("2026-02-01") },
      ],
    })
    await buildProfilesForOrg(client, ORG, { now: NOW })
    expect(profiles).toHaveLength(2) // contact profile + web-chat-visitor profile
    const contactProfile = profiles.find((p) => p.emailNormalized === "a@x.com")
    const webProfile = profiles.find((p) => p.emailNormalized === "b@y.com")
    expect(contactProfile?.totalSpent).toBe(500) // invoice attributed to the contact
    expect(webProfile?.totalSpent).toBe(0) // NOT stolen by the web-chat profile
  })

  it("merges a contact + a lead sharing an email into ONE multi-channel profile", async () => {
    const { client, profiles } = makeClient({
      contacts: [contact({ id: "c1", email: "shared@x.com", fullName: "Real Name" })],
      leads: [lead({ id: "l1", email: "shared@x.com", contactName: "Lead Name" })],
    })
    const res = await buildProfilesForOrg(client, ORG, { now: NOW })
    expect(res.profilesCreated).toBe(1) // lead merges into the contact's profile
    expect(profiles).toHaveLength(1)
    expect(profiles[0].channelsActive).toEqual(["contact", "lead"]) // both channels, sorted
  })
})

describe("buildProfilesForOrg — multi-contact invoice aggregation (P2 fix)", () => {
  it("counts invoices from ALL merged contacts, not just the primary", async () => {
    const { client, profiles } = makeClient({
      contacts: [
        contact({ id: "c1", email: "dup@x.com", phone: "+994500000010" }),
        contact({ id: "c2", email: "dup@x.com", phone: "+994500000011" }), // merges into c1's profile
      ],
      invoices: [
        { id: "i1", organizationId: ORG, contactId: "c1", companyId: null, totalAmount: 100, currency: "AZN", status: "paid", paidAt: new Date("2026-02-01") },
        { id: "i2", organizationId: ORG, contactId: "c2", companyId: null, totalAmount: 200, currency: "AZN", status: "paid", paidAt: new Date("2026-03-01") },
      ],
    })
    await buildProfilesForOrg(client, ORG, { now: NOW })
    expect(profiles).toHaveLength(1)
    // Pre-P2-fix this was 100 (only primaryContactId c1). With the fix it's 300 —
    // c2's invoice is collected via its contact source.
    expect(profiles[0].totalSpent).toBe(300)
    expect(profiles[0].lifetimeOrderCount).toBe(2)
  })
})

describe("refreshProfileForSource — real-time single-source hook", () => {
  it("creates + aggregates a profile for a brand-new contact", async () => {
    const { client, profiles } = makeClient({
      contacts: [contact({ id: "c1", email: "rt@x.com", fullName: "Realtime" })],
      invoices: [
        { id: "i1", organizationId: ORG, contactId: "c1", companyId: null, totalAmount: 150, currency: "AZN", status: "paid", paidAt: new Date("2026-02-01") },
      ],
    })
    const res = await refreshProfileForSource(client, ORG, "contact", "c1", { now: NOW })
    expect(res.action).toBe("created")
    expect(res.profileId).not.toBeNull()
    expect(profiles).toHaveLength(1)
    expect(profiles[0].emailNormalized).toBe("rt@x.com")
    expect(profiles[0].totalSpent).toBe(150) // aggregated immediately, not waiting for cron
    expect(profiles[0].lastRefreshedAt).toEqual(NOW)
  })

  it("merges a source into an existing profile (no duplicate)", async () => {
    const { client, profiles } = makeClient({
      contacts: [contact({ id: "c1", email: "same@x.com" })],
      leads: [lead({ id: "l1", email: "same@x.com", contactName: "Same Person" })],
    })
    await refreshProfileForSource(client, ORG, "contact", "c1", { now: NOW })
    const res = await refreshProfileForSource(client, ORG, "lead", "l1", { now: NOW })
    expect(res.action).toBe("merged")
    expect(profiles).toHaveLength(1) // lead merged into the contact's profile
    expect(profiles[0].channelsActive).toEqual(["contact", "lead"])
  })

  it("returns source_not_found for an unknown id (stale/raced hook)", async () => {
    const { client, profiles } = makeClient({ contacts: [] })
    const res = await refreshProfileForSource(client, ORG, "contact", "ghost", { now: NOW })
    expect(res.action).toBe("source_not_found")
    expect(res.profileId).toBeNull()
    expect(profiles).toHaveLength(0)
  })

  it("rejects a source with no identity (no profile created)", async () => {
    const { client, profiles } = makeClient({
      contacts: [contact({ id: "c1", fullName: "No Identity" })],
    })
    const res = await refreshProfileForSource(client, ORG, "contact", "c1", { now: NOW })
    expect(res.action).toBe("rejected")
    expect(res.profileId).toBeNull()
    expect(profiles).toHaveLength(0)
  })

  it("re-aggregates ONLY the targeted profile, not others (scoped)", async () => {
    const { client, profiles } = makeClient({
      contacts: [contact({ id: "c1", email: "a@x.com" }), contact({ id: "c2", email: "b@x.com" })],
      invoices: [
        { id: "i1", organizationId: ORG, contactId: "c2", companyId: null, totalAmount: 400, currency: "AZN", status: "paid", paidAt: new Date("2026-02-01") },
      ],
    })
    await buildProfilesForOrg(client, ORG, { now: NOW })
    // Sentinel: corrupt c1's profile to detect whether a scoped refresh of c2 touches it.
    const c1 = profiles.find((p) => p.emailNormalized === "a@x.com")!
    c1.totalSpent = -1
    await refreshProfileForSource(client, ORG, "contact", "c2", { now: NOW })
    expect(profiles.find((p) => p.emailNormalized === "a@x.com")!.totalSpent).toBe(-1) // untouched
    expect(profiles.find((p) => p.emailNormalized === "b@x.com")!.totalSpent).toBe(400) // recomputed
  })

  it("re-firing the SAME source is idempotent (no duplicate profile or source)", async () => {
    const { client, profiles, sources } = makeClient({
      contacts: [contact({ id: "c1", email: "idem@x.com" })],
    })
    await refreshProfileForSource(client, ORG, "contact", "c1", { now: NOW })
    await refreshProfileForSource(client, ORG, "contact", "c1", { now: NOW })
    await refreshProfileForSource(client, ORG, "contact", "c1", { now: NOW })
    expect(profiles).toHaveLength(1) // one profile despite 3 fires (2nd/3rd merge_into self)
    expect(sources.filter((s) => s.sourceId === "c1")).toHaveLength(1) // one source row (upsert)
  })
})
