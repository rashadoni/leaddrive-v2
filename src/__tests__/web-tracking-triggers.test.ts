/**
 * C4 — fireWebActivityWorkflows: the entity a web_activity workflow rule
 * conditions on (contact fields + batch context + 7-day rolling counters),
 * the no-rules fast path, and the post-match cooldown.
 *
 * NB: the cooldown map is module-global — each test uses its own org/contact
 * ids so states don't bleed between cases.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: vi.fn().mockResolvedValue(0) }))

import { fireWebActivityWorkflows, WEB_TRIGGER_COOLDOWN_MS } from "@/lib/web-tracking-triggers"
import { executeWorkflows } from "@/lib/workflow-engine"

const CONTACT = {
  id: "ct-1", fullName: "Alice", email: "a@b.test", phone: null,
  lifecycleStage: "mql", category: "vip", source: "website", tags: ["vip"], companyId: null,
}

function client(opts: { contact?: object | null; urls?: (string | null)[]; rules?: number; count?: number } = {}) {
  const urls = opts.urls ?? []
  return {
    workflowRule: { count: vi.fn().mockResolvedValue(opts.rules ?? 1) },
    contact: { findFirst: vi.fn().mockResolvedValue(opts.contact === undefined ? CONTACT : opts.contact) },
    webAction: {
      count: vi.fn().mockResolvedValue(opts.count ?? urls.length),
      findMany: vi.fn().mockResolvedValue(urls.map((url) => ({ url }))),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(executeWorkflows).mockResolvedValue(0)
})

describe("fireWebActivityWorkflows", () => {
  it("fires contact/web_activity with batch context and rolling counters", async () => {
    const c = client({ urls: ["https://s.t/pricing", "https://s.t/blog", "https://s.t/checkout"], count: 42 })
    await fireWebActivityWorkflows(c as never, {
      organizationId: "org-a",
      contactId: "ct-1",
      events: [
        { type: "pageview", url: "https://s.t/blog" },
        { type: "pageview", url: "https://s.t/pricing?plan=pro" },
        { type: "event", name: "cta_click" },
      ],
    })
    expect(executeWorkflows).toHaveBeenCalledTimes(1)
    const [org, entityType, trigger, entity] = vi.mocked(executeWorkflows).mock.calls[0]
    expect(org).toBe("org-a")
    expect(entityType).toBe("contact")
    expect(trigger).toBe("web_activity")
    expect(entity).toMatchObject({
      id: "ct-1",
      fullName: "Alice",
      // the high-intent page of the batch wins the pageUrl slot
      pageUrl: "https://s.t/pricing?plan=pro",
      eventName: "cta_click",
      isHighIntent: true,
      batchPageViews: 2,
      pageViews7d: 42, // exact SQL count, NOT the capped slice length
      highIntentViews7d: 2, // pricing + checkout of the recent slice
    })
  })

  it("bails before any contact/counter queries when the org has no web_activity rules", async () => {
    const c = client({ rules: 0 })
    await fireWebActivityWorkflows(c as never, {
      organizationId: "org-b", contactId: "ct-1", events: [{ type: "pageview", url: "x" }],
    })
    expect(c.contact.findFirst).not.toHaveBeenCalled()
    expect(c.webAction.findMany).not.toHaveBeenCalled()
    expect(executeWorkflows).not.toHaveBeenCalled()
  })

  it("post-match cooldown suppresses evaluation; a no-match run does NOT burn it", async () => {
    const base = { organizationId: "org-c", contactId: "ct-cool" }
    const events = [{ type: "pageview" as const, url: "https://s.t/pricing" }]
    const t0 = 1_700_000_000_000

    // run 1: nothing matches → next run still evaluates
    const c1 = client()
    await fireWebActivityWorkflows(c1 as never, { ...base, events, now: new Date(t0) })
    const c2 = client()
    vi.mocked(executeWorkflows).mockResolvedValueOnce(1) // run 2 matches
    await fireWebActivityWorkflows(c2 as never, { ...base, events, now: new Date(t0 + 1000) })
    expect(executeWorkflows).toHaveBeenCalledTimes(2)

    // run 3 inside the cooldown → fully suppressed
    const c3 = client()
    await fireWebActivityWorkflows(c3 as never, { ...base, events, now: new Date(t0 + 2000) })
    expect(c3.workflowRule.count).not.toHaveBeenCalled()
    expect(executeWorkflows).toHaveBeenCalledTimes(2)

    // run 4 after the window → evaluates again
    const c4 = client()
    await fireWebActivityWorkflows(c4 as never, { ...base, events, now: new Date(t0 + 1000 + WEB_TRIGGER_COOLDOWN_MS + 1) })
    expect(executeWorkflows).toHaveBeenCalledTimes(3)
  })

  it("counter query is scoped to the contact's stitched sessions in the window", async () => {
    const c = client()
    await fireWebActivityWorkflows(c as never, {
      organizationId: "org-d",
      contactId: "ct-1",
      events: [{ type: "pageview", url: "https://s.t/x" }],
      now: new Date(1_700_000_000_000),
    })
    const q = c.webAction.findMany.mock.calls[0][0]
    expect(q.where).toMatchObject({
      organizationId: "org-d",
      type: "pageview",
      session: { contactId: "ct-1" },
    })
    expect(q.where.createdAt.gte.getTime()).toBe(1_700_000_000_000 - 7 * 24 * 3600 * 1000)
    // exact counter hits the same where
    expect(c.webAction.count.mock.calls[0][0].where).toEqual(q.where)
  })

  it("no-ops on an empty batch or a vanished contact, and never throws", async () => {
    const c1 = client()
    await fireWebActivityWorkflows(c1 as never, { organizationId: "org-e", contactId: "ct-1", events: [] })
    expect(executeWorkflows).not.toHaveBeenCalled()

    const c2 = client({ contact: null })
    await fireWebActivityWorkflows(c2 as never, {
      organizationId: "org-e", contactId: "ct-gone", events: [{ type: "pageview", url: "x" }],
    })
    expect(executeWorkflows).not.toHaveBeenCalled()

    // engine explosion is swallowed (ingest path must not be disturbed)
    vi.mocked(executeWorkflows).mockRejectedValueOnce(new Error("boom"))
    const c3 = client()
    await expect(
      fireWebActivityWorkflows(c3 as never, {
        organizationId: "org-e", contactId: "ct-1", events: [{ type: "pageview", url: "x" }],
      }),
    ).resolves.toBeUndefined()
  })
})
