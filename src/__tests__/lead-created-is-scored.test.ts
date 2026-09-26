import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

/**
 * Every path that creates a lead must leave it scored.
 *
 * scoreLeadNow exists so that a lead arrives with a real number. Before it, a
 * new lead showed "0/100 (F)" until a timer came round, which is the product
 * calling the customer worthless. Six creation paths never called it: the
 * public web-lead API, the landing-page form, the form builder, TikTok Lead
 * Ads, the Inbox handoff and the social-mention conversion. Production runs no
 * scheduled sweep either, so their leads stayed unscored until somebody
 * happened to save them.
 *
 * The fake database below is small, but honest about the two things that
 * decide whether scoring can work at all:
 *
 * - Row-level security fails closed. With no tenant context a read sees
 *   nothing and a write is refused, as FORCE ROW LEVEL SECURITY does on prod.
 *   The context is the real one from @/lib/rls-context, so a scorer called
 *   outside the route's tenant scope finds no lead and stamps nothing.
 * - A transaction's writes stay invisible outside it until it commits. The
 *   scorer reads through the global client, so a scorer called inside the
 *   route's transaction does not find the lead either.
 *
 * Either mistake leaves lastScoredAt unset, and lastScoredAt is what these
 * tests read: from the stored row, not from a spy on the scorer.
 */

const fake = vi.hoisted(() => {
  type Row = Record<string, any>
  type Tables = Map<string, Map<string, Row | null>>
  type Ctx = { orgId?: string; bypass?: boolean } | undefined

  // Tables without a tenant policy on prod.
  const GLOBAL_TABLES = new Set(["organization"])
  // Column defaults the scorer and the assertions read.
  const DEFAULTS: Record<string, Row> = {
    lead: {
      score: 0,
      scoreDetails: null,
      lastScoredAt: null,
      email: null,
      phone: null,
      phoneWhatsApp: null,
      telegramHandle: null,
      companyName: null,
      source: null,
      interest: null,
      notes: null,
      estimatedValue: null,
      customerStage: null,
      salesCallOutcomes: [],
    },
  }

  const committed: Tables = new Map()
  let seq = 0
  let readContext: () => Ctx = () => undefined

  function tableOf(store: Tables, model: string) {
    let table = store.get(model)
    if (!table) {
      table = new Map()
      store.set(model, table)
    }
    return table
  }

  function visible(model: string, row: Row, ctx: Ctx) {
    if (GLOBAL_TABLES.has(model)) return true
    if (!ctx) return false
    return ctx.bypass === true || row.organizationId === ctx.orgId
  }

  function jsonPath(value: unknown, path: string[]) {
    return path.reduce<any>((cur, key) => (cur == null ? undefined : cur[key]), value)
  }

  function matches(row: Row, where?: Row): boolean {
    if (!where) return true
    return Object.entries(where).every(([key, cond]) => {
      if (cond === undefined) return true
      if (key === "OR") return (cond as Row[]).some((w) => matches(row, w))
      if (key === "AND") return (Array.isArray(cond) ? cond : [cond]).every((w: Row) => matches(row, w))
      if (key === "NOT") return !matches(row, cond as Row)
      if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
        if ("path" in cond) {
          if (!("equals" in cond)) throw new Error(`fake db: unsupported JSON filter on ${key}`)
          return jsonPath(row[key], cond.path as string[]) === cond.equals
        }
        const ops = Object.keys(cond)
        if (ops.length > 0 && ops.every((op) => ["equals", "not", "in", "notIn"].includes(op))) {
          return ops.every((op) => {
            const value = row[key] ?? null
            if (op === "equals") return value === cond.equals
            if (op === "not") return cond.not === null ? value !== null : value !== cond.not
            if (op === "in") return (cond.in as unknown[]).includes(value)
            return !(cond.notIn as unknown[]).includes(value)
          })
        }
        // Compound unique key, e.g. organizationId_slug: { organizationId, slug }.
        if (key.includes("_") && !(key in row)) {
          return Object.entries(cond as Row).every(([field, value]) => (row[field] ?? null) === value)
        }
        throw new Error(`fake db: unsupported filter ${key}=${JSON.stringify(cond)}`)
      }
      return (row[key] ?? null) === cond
    })
  }

  function withoutUndefined(data: Row) {
    return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))
  }

  function delegate(model: string, pending?: Tables) {
    const rows = (): Row[] => {
      const merged = new Map(tableOf(committed, model))
      if (pending) {
        for (const [id, row] of tableOf(pending, model)) {
          if (row === null) merged.delete(id)
          else merged.set(id, row)
        }
      }
      return [...merged.values()].filter((row): row is Row => row !== null)
    }
    const put = (id: string, row: Row | null) => {
      if (pending) tableOf(pending, model).set(id, row)
      else if (row === null) tableOf(committed, model).delete(id)
      else tableOf(committed, model).set(id, row)
    }
    const find = (args: Row = {}) => {
      const ctx = readContext()
      const found = rows().filter((row) => visible(model, row, ctx) && matches(row, args.where))
      const order = args.orderBy && !Array.isArray(args.orderBy) ? Object.entries(args.orderBy)[0] : null
      if (!order) return found
      const [field, direction] = order as [string, string]
      const sign = direction === "desc" ? -1 : 1
      return [...found].sort((a, b) => (a[field] > b[field] ? sign : a[field] < b[field] ? -sign : 0))
    }
    const apply = (row: Row, data: Row): Row => {
      const next: Row = { ...row, updatedAt: new Date() }
      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) continue
        if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
          && ("increment" in value || "decrement" in value)) {
          next[key] = (next[key] ?? 0) + (value.increment ?? 0) - (value.decrement ?? 0)
        } else {
          next[key] = value
        }
      }
      return next
    }
    return {
      async create({ data }: Row) {
        if (!GLOBAL_TABLES.has(model)) {
          const ctx = readContext()
          if (!ctx) throw new Error(`fake RLS: insert into ${model} with no tenant context`)
          if (!ctx.bypass && data.organizationId !== ctx.orgId) {
            throw new Error(`fake RLS: ${model} row outside the current tenant`)
          }
        }
        const id = data.id ?? `${model}_${++seq}`
        const row = { ...DEFAULTS[model], createdAt: new Date(), updatedAt: new Date(), ...withoutUndefined(data), id }
        put(id, row)
        return { ...row }
      },
      async findFirst(args?: Row) {
        const row = find(args)[0]
        return row ? { ...row } : null
      },
      async findUnique(args?: Row) {
        const row = find(args)[0]
        return row ? { ...row } : null
      },
      async findMany(args?: Row) {
        return find(args).map((row) => ({ ...row }))
      },
      async count(args?: Row) {
        return find(args).length
      },
      async update({ where, data }: Row) {
        const target = find({ where })[0]
        if (!target) throw new Error(`fake db: record to update not found in ${model}`)
        const next = apply(target, data)
        put(target.id, next)
        return { ...next }
      },
      async updateMany({ where, data }: Row) {
        const targets = find({ where })
        for (const target of targets) put(target.id, apply(target, data))
        return { count: targets.length }
      },
      async delete({ where }: Row) {
        const target = find({ where })[0]
        if (!target) throw new Error(`fake db: record to delete not found in ${model}`)
        put(target.id, null)
        return { ...target }
      },
      async groupBy({ by, where }: Row) {
        const groups = new Map<string, { key: Row; count: number }>()
        for (const row of find({ where })) {
          const key = Object.fromEntries((by as string[]).map((field) => [field, row[field]]))
          const id = JSON.stringify(key)
          const group = groups.get(id) ?? { key, count: 0 }
          group.count += 1
          groups.set(id, group)
        }
        return [...groups.values()].map(({ key, count }) => ({ ...key, _count: { id: count } }))
      },
    }
  }

  function client(pending?: Tables): any {
    const base: Row = {
      // Interactive transactions stage their writes and publish them only when
      // the callback resolves; a throw discards them. Global-client calls made
      // inside the callback write straight through, as they do on prod, where
      // they run on their own pooled connection.
      async $transaction(arg: unknown) {
        if (Array.isArray(arg)) return Promise.all(arg)
        const staged: Tables = new Map()
        const result = await (arg as (tx: unknown) => Promise<unknown>)(client(staged))
        for (const [model, rows] of staged) {
          const table = tableOf(committed, model)
          for (const [id, row] of rows) {
            if (row === null) table.delete(id)
            else table.set(id, row)
          }
        }
        return result
      },
      $executeRaw: async () => 0,
      $executeRawUnsafe: async () => 0,
      $queryRaw: async () => [],
    }
    return new Proxy(base, {
      get(target, prop) {
        if (typeof prop !== "string") return undefined
        if (prop in target) return target[prop]
        if (prop === "then" || prop.startsWith("$") || prop.startsWith("_")) return undefined
        return delegate(prop, pending)
      },
    })
  }

  return {
    client,
    reset() {
      committed.clear()
      seq = 0
    },
    seed(model: string, rows: Row[]) {
      const table = tableOf(committed, model)
      for (const row of rows) table.set(row.id, { ...DEFAULTS[model], createdAt: new Date(), ...row })
    },
    /** Committed rows as stored, read past RLS: the assertions look at the table itself. */
    all(model: string): Row[] {
      return [...tableOf(committed, model).values()].filter((row): row is Row => row !== null)
    },
    setContextReader(read: () => Ctx) {
      readContext = read
    },
  }
})

const auth = vi.hoisted(() => ({
  current: {
    orgId: "org_a",
    userId: "manager_1",
    role: "manager",
    email: "manager@example.az",
    name: "Manager",
  },
}))

vi.mock("@/lib/prisma", () => ({ prisma: fake.client(), logAudit: vi.fn() }))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(async () => auth.current),
  getOrgId: vi.fn(async () => auth.current.orgId),
  requireAuth: vi.fn(async () => auth.current),
  requireSessionAuth: vi.fn(async () => auth.current),
  isAuthError: vi.fn((value: unknown) => value instanceof Response),
}))

vi.mock("@/lib/public-abuse-guard", () => ({
  consumePublicRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0, unavailable: false })),
  reservePublicAction: vi.fn(async () => ({
    allowed: true,
    retryAfterSeconds: 0,
    unavailable: false,
    backend: "memory",
    cooldownKey: "test:cooldown",
    windowKey: "test:window",
    token: "test-token",
  })),
  releasePublicActionReservation: vi.fn(async () => undefined),
}))

// Side effects that are not about scoring. Each has its own tests.
vi.mock("@/lib/lead-assignment", () => ({ applyLeadAssignmentRules: vi.fn(async () => undefined) }))
vi.mock("@/lib/sequences-auto-enroll", () => ({ autoEnrollLeadIntoSequences: vi.fn(async () => undefined) }))
vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: vi.fn(async () => undefined) }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn(async () => undefined) }))
vi.mock("@/lib/unified-profile/profile-builder", () => ({ refreshProfileForSource: vi.fn(async () => undefined) }))
vi.mock("@/lib/inbox/sales-assignment", () => ({ getSalesAssignmentCandidates: vi.fn(async () => []) }))
vi.mock("@/lib/social/ingest-mention", () => ({
  ingestMentionWithResult: vi.fn(async () => ({ id: "mention_ingested", created: true })),
}))
vi.mock("@/lib/social/monitoring-import-fence", () => ({
  withSocialMonitoringTenantCollectionFence: async (_organizationId: string, run: () => Promise<unknown>) => (
    { allowed: true, value: await run() }
  ),
}))
// Phone/email matching has its own tests. Answering "no match" here keeps the
// TikTok retry test honest: the only way a retry finds its lead again is the
// provider id the webhook stored on it.
vi.mock("@/lib/inbound-lead-match", () => ({ matchInboundLeadId: vi.fn(async () => null) }))

import { getRlsContext, runWithTenant } from "@/lib/rls-context"
import { scoreLeadNow } from "@/lib/ai/lead-scoring"
import { POST as postPublicLead } from "@/app/api/v1/public/leads/route"
import { POST as postLandingForm } from "@/app/api/v1/public/form-submit/route"
import { POST as postBuiltForm } from "@/app/api/v1/public/forms/[slug]/submit/route"
import { POST as postTikTokBusiness } from "@/app/api/v1/webhooks/tiktok-business/route"
import { POST as postInboxHandoff } from "@/app/api/v1/inbox/conversations/[id]/convert-to-lead/route"
import { POST as postMentionConversion } from "@/app/api/v1/social/mentions/[id]/convert-to-lead/route"

fake.setContextReader(getRlsContext)

const ORG = "org_a"

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify(body),
  })
}

function onlyLead() {
  const leads = fake.all("lead")
  expect(leads).toHaveLength(1)
  return leads[0]
}

function expectScored(lead: Record<string, any>) {
  expect(lead.lastScoredAt).toBeInstanceOf(Date)
  expect(lead.score).toBeGreaterThan(0)
  expect(lead.scoreDetails).toMatchObject({ factors: expect.any(Object) })
}

const tiktokEvent = {
  event: "lead.created",
  data: {
    lead_id: "lead_tiktok_1",
    form_id: "form_1",
    campaign_id: "camp_1",
    adgroup_id: "ag_1",
    ad_id: "ad_1",
    fields: [
      { name: "full_name", value: "Aysel Aliyeva" },
      { name: "email", value: "aysel@example.com" },
      { name: "phone", value: "+994501112233" },
    ],
  },
}

beforeEach(() => {
  fake.reset()
  fake.seed("organization", [{ id: ORG, slug: "acme", isActive: true }])
})

describe("the harness catches the two ways scoring silently does nothing", () => {
  it("finds no lead from outside the tenant scope", async () => {
    fake.seed("lead", [{ id: "lead_seeded", organizationId: ORG, contactName: "Seeded", phone: "+994501112233" }])

    await expect(scoreLeadNow(ORG, "lead_seeded")).resolves.toBeNull()
    expect(fake.all("lead")[0].lastScoredAt).toBeNull()

    await expect(runWithTenant(ORG, () => scoreLeadNow(ORG, "lead_seeded"))).resolves.toEqual(expect.any(Number))
    expect(fake.all("lead")[0].lastScoredAt).toBeInstanceOf(Date)
  })

  it("cannot see a lead its transaction has not committed yet", async () => {
    // The same store the mocked @/lib/prisma serves, reached untyped so the
    // test does not have to satisfy the full Prisma create input.
    const db = fake.client()
    let scoredInside: number | null = -1
    const lead = await runWithTenant(ORG, () => db.$transaction(async (tx: any) => {
      const created = await tx.lead.create({ data: { organizationId: ORG, contactName: "Staged", phone: "+994501112233" } })
      scoredInside = await scoreLeadNow(ORG, created.id)
      return created
    }))

    expect(scoredInside).toBeNull()
    expect(fake.all("lead")[0].lastScoredAt).toBeNull()
    await expect(runWithTenant(ORG, () => scoreLeadNow(ORG, lead.id))).resolves.toEqual(expect.any(Number))
  })
})

describe("a lead is scored on every path that creates it", () => {
  it("public web-lead API", async () => {
    const res = await postPublicLead(jsonRequest("http://localhost/api/v1/public/leads", {
      org_slug: "acme",
      name: "Leyla Mammadova",
      email: "leyla@example.az",
      phone: "+994501112233",
      source: "website",
      message: "Need a quote for 40 seats",
    }))

    expect(res.status).toBe(201)
    expectScored(onlyLead())
  })

  it("landing-page form, after the submission transaction commits", async () => {
    fake.seed("landingPage", [{ id: "page_1", organizationId: ORG, name: "Spring offer", status: "published", totalSubmissions: 0 }])

    const res = await postLandingForm(jsonRequest("http://localhost/api/v1/public/form-submit", {
      orgId: ORG,
      pageId: "page_1",
      name: "Rauf Hasanov",
      email: "rauf@example.az",
      phone: "+994551234567",
    }))

    expect(res.status).toBe(201)
    const lead = onlyLead()
    expectScored(lead)
    expect(fake.all("formSubmission")[0].leadId).toBe(lead.id)
  })

  it("form-builder form with automatic lead creation", async () => {
    fake.seed("formDefinition", [{
      id: "form_def_1",
      organizationId: ORG,
      slug: "contact",
      status: "published",
      leadAutoCreate: true,
      campaignId: null,
      totalSubmissions: 0,
      fields: [
        { key: "name", type: "text", label: "Name" },
        { key: "email", type: "email", label: "Email", required: true },
      ],
    }])

    const res = await postBuiltForm(
      jsonRequest(`http://localhost/api/v1/public/forms/contact/submit?org=${ORG}`, {
        values: { name: "Gunel Aliyeva", email: "gunel@example.az" },
      }),
      { params: Promise.resolve({ slug: "contact" }) },
    )

    expect(res.status).toBe(200)
    expectScored(onlyLead())
  })

  it("TikTok Lead Ads, and a retry of the same event still finds that lead", async () => {
    fake.seed("channelConnection", [{
      id: "cc_business",
      organizationId: ORG,
      platform: "tiktok",
      surface: "lead_ad",
      provider: "tiktok_business",
      status: "connected",
      apiKey: null,
      capabilities: { read: true, reply: false, webhook: true, importLead: true },
      settings: { webhookSecret: "business_secret" },
    }])
    const url = "http://localhost/api/v1/webhooks/tiktok-business?token=business_secret"

    const first = await postTikTokBusiness(jsonRequest(url, tiktokEvent))
    expect(first.status).toBe(200)
    const lead = onlyLead()
    expectScored(lead)
    // The webhook finds its own leads again by the provider id it stores in
    // scoreDetails. Scoring rewrites the explanation, and must leave that alone.
    expect(lead.scoreDetails).toMatchObject({ tiktokLeadId: "lead_tiktok_1", adId: "ad_1" })

    const retry = await postTikTokBusiness(jsonRequest(url, tiktokEvent))
    const retried = await retry.json()
    expect(retried.data.results[0]).toMatchObject({ leadId: lead.id, status: "already_linked" })
    expect(fake.all("lead")).toHaveLength(1)
  })

  it("Inbox handoff to sales, after the conversion transaction commits", async () => {
    fake.seed("user", [{ id: "seller_1", organizationId: ORG, role: "sales", isActive: true, name: "Kenan", email: "kenan@example.az" }])
    fake.seed("pipeline", [{ id: "pipe_smm", organizationId: ORG, name: "SMM", isActive: true }])
    fake.seed("socialConversation", [{
      id: "conv_1",
      organizationId: ORG,
      platform: "tiktok",
      externalId: "raw-user-id",
      contactName: "Kanan Mammadov",
      metadata: {},
      messages: [{
        from: "raw-user-id",
        body: "55 düym televizorun qiyməti nədir?",
        direction: "inbound",
        createdAt: new Date(),
        metadata: { senderUsername: "kanan_tv" },
      }],
    }])

    const res = await postInboxHandoff(
      jsonRequest("http://localhost/api/v1/inbox/conversations/conv_1/convert-to-lead", {
        assignedTo: "seller_1",
        contactName: "Kanan Mammadov",
        phone: "+994501234567",
        sourceProfileUrl: "https://www.tiktok.com/@kanan_tv",
        interest: "55-inch TV, wants the price and delivery this week",
      }),
      { params: Promise.resolve({ id: "conv_1" }) },
    )

    expect(res.status).toBe(201)
    expectScored(onlyLead())
  })

  it("Inbox handoff that updates the lead the conversation already produced", async () => {
    fake.seed("user", [{ id: "seller_1", organizationId: ORG, role: "sales", isActive: true, name: "Kenan", email: "kenan@example.az" }])
    fake.seed("lead", [{ id: "lead_linked", organizationId: ORG, contactName: "Kanan", source: "tiktok" }])
    fake.seed("socialConversation", [{
      id: "conv_2",
      organizationId: ORG,
      platform: "tiktok",
      externalId: "raw-user-id",
      contactName: "Kanan Mammadov",
      metadata: { qualificationLeadId: "lead_linked" },
      messages: [],
    }])

    const res = await postInboxHandoff(
      jsonRequest("http://localhost/api/v1/inbox/conversations/conv_2/convert-to-lead", {
        assignedTo: "seller_1",
        contactName: "Kanan Mammadov",
        phone: "+994501234567",
        sourceProfileUrl: "https://www.tiktok.com/@kanan_tv",
      }),
      { params: Promise.resolve({ id: "conv_2" }) },
    )

    expect(res.status).toBe(200)
    expectScored(onlyLead())
  })

  it("social-mention conversion, once the mention is claimed", async () => {
    fake.seed("socialMention", [{
      id: "mention_1",
      organizationId: ORG,
      platform: "instagram",
      authorName: "Nigar Huseynova",
      authorHandle: "nigar.h",
      text: "Do you deliver to Ganja?",
      sentiment: "neutral",
      url: null,
      leadId: null,
    }])

    const res = await postMentionConversion(
      jsonRequest("http://localhost/api/v1/social/mentions/mention_1/convert-to-lead", { phone: "+994551234567" }),
      { params: Promise.resolve({ id: "mention_1" }) },
    )

    expect(res.status).toBe(200)
    const lead = onlyLead()
    expectScored(lead)
    expect(fake.all("socialMention")[0].leadId).toBe(lead.id)
  })
})

describe("rescoring a lead", () => {
  it("replaces the explanation and keeps what other code stored in scoreDetails", async () => {
    fake.seed("lead", [{
      id: "lead_tiktok",
      organizationId: ORG,
      contactName: "Aysel Aliyeva",
      phone: "+994501112233",
      source: "tiktok:lead_ad",
      scoreDetails: {
        tiktokLeadId: "lead_tiktok_1",
        formId: "form_1",
        factors: { contactCompleteness: 1 },
        reasoning: "Written for a score this lead no longer has",
        conversionProb: 64,
        grade: "B",
        aiPowered: true,
      },
    }])

    await runWithTenant(ORG, () => scoreLeadNow(ORG, "lead_tiktok"))

    const details = fake.all("lead")[0].scoreDetails
    expect(details).toMatchObject({ tiktokLeadId: "lead_tiktok_1", formId: "form_1" })
    expect(details.factors).toMatchObject({ contactCompleteness: expect.any(Number), engagementLevel: expect.any(Number) })
    expect(details).not.toHaveProperty("reasoning")
    expect(details).not.toHaveProperty("conversionProb")
    expect(details).not.toHaveProperty("grade")
    expect(details).not.toHaveProperty("aiPowered")
  })
})
