// Task 10 (T10b) — public RSC pages two-phase RLS scoping, behavioral pin.
//
// Invokes the REAL page server components with the REAL rls-context module
// (AsyncLocalStorage) and a prisma mock that captures getRlsContext() AT QUERY
// TIME — the moment the RLS extension hook would fire in production. Pins the
// invariant for each pattern shape:
//
//   • token/slug/host → org resolution lookup runs under { bypass: true }
//   • ALL post-resolution data work runs under { orgId: <resolved org> }
//   • /f/[slug] SPECIAL: the URL carries the org id explicitly → NO bypass at
//     all; the lookup itself runs tenant-scoped under the caller-supplied org
//
// Pages covered (every prisma-using public page in the sweep):
//   /s/[slug]            — survey by publicSlug (bypass) + prior-response (tenant)
//   /s/unsubscribe       — survey by link id (bypass) + unsubscribe read/write (tenant)
//   /f/[slug]            — org from ?org= → tenant-only (lookup + view counter)
//   /c/[token]           — cobrowse session by joinToken (bypass), render tenant-wrapped
//   /embed/chat/[key]    — widget by publicKey (bypass), render tenant-wrapped
//   /(public)/p/[slug]   — landing page by slug (bypass) + analytics writes (tenant)
//   /(public)/_custom-domain — domain → org (bypass) + index/page/writes (tenant)
import { describe, it, expect, vi, beforeEach } from "vitest"
import { getRlsContext, type RlsContext } from "@/lib/rls-context"

/** ctx snapshots keyed by "<model>.<op>", captured when the mock query executes. */
const seen: Array<{ call: string; ctx: RlsContext | undefined }> = []
const cap = (call: string) => seen.push({ call, ctx: getRlsContext() })
const ctxOf = (call: string) => seen.filter((s) => s.call === call).map((s) => s.ctx)

vi.mock("@/lib/prisma", () => ({
  prisma: {
    survey: {
      findUnique: vi.fn(async () => {
        cap("survey.findUnique")
        return {
          id: "sv1",
          organizationId: "org1",
          publicSlug: "sl",
          status: "active",
          name: "NPS",
          description: null,
          type: "nps",
          questions: [],
          thankYouText: null,
          organization: { id: "org1", name: "Org", branding: {}, logo: null },
        }
      }),
    },
    surveyResponse: {
      findFirst: vi.fn(async () => { cap("surveyResponse.findFirst"); return null }),
    },
    surveyUnsubscribe: {
      findFirst: vi.fn(async () => { cap("surveyUnsubscribe.findFirst"); return null }),
      create: vi.fn(async () => { cap("surveyUnsubscribe.create"); return { id: "u1" } }),
    },
    formDefinition: {
      findUnique: vi.fn(async () => {
        cap("formDefinition.findUnique")
        return {
          id: "f1",
          organizationId: "org1",
          name: "Form",
          slug: "fs",
          description: null,
          fields: [],
          status: "published",
          successMessage: null,
          redirectUrl: null,
        }
      }),
      update: vi.fn(async () => { cap("formDefinition.update"); return { id: "f1" } }),
    },
    cobrowseSession: {
      findUnique: vi.fn(async () => {
        cap("cobrowseSession.findUnique")
        return { id: "cb1", status: "pending", organizationId: "org1", organization: { name: "Org" } }
      }),
    },
    webChatWidget: {
      findUnique: vi.fn(async () => {
        cap("webChatWidget.findUnique")
        return {
          id: "w1",
          organizationId: "org1",
          publicKey: "k1",
          enabled: true,
          title: "Chat",
          greeting: null,
          primaryColor: "#fff",
          offlineMessage: null,
          workingHours: null,
          organization: { name: "Org" },
        }
      }),
    },
    landingPage: {
      findFirst: vi.fn(async () => {
        cap("landingPage.findFirst")
        return {
          id: "lp1",
          organizationId: "org1",
          slug: "ls",
          status: "published",
          name: "LP",
          metaTitle: null,
          metaDescription: null,
          ogImage: null,
          cssContent: null,
          htmlContent: "<div></div>",
        }
      }),
      findMany: vi.fn(async () => { cap("landingPage.findMany"); return [] }),
      update: vi.fn(async () => { cap("landingPage.update"); return { id: "lp1" } }),
    },
    pageView: {
      create: vi.fn(async () => { cap("pageView.create"); return { id: "pv1" } }),
    },
    customDomain: {
      findUnique: vi.fn(async () => {
        cap("customDomain.findUnique")
        return { id: "cd1", organizationId: "org1", domain: "pages.acme.test", status: "ssl_active" }
      }),
    },
  },
}))

// Server-only Next plumbing — pages read these but they carry no DB work.
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
}))
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: () => null })),
}))
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}))

// Pure helpers / verification — stubbed so the happy path is deterministic.
vi.mock("@/lib/survey-triggers", () => ({ verifyUnsubToken: vi.fn(() => true) }))
vi.mock("@/lib/cobrowse/tokens", () => ({ isValidJoinTokenShape: vi.fn(() => true) }))
vi.mock("@/lib/widget-hours", () => ({ isWidgetOnline: vi.fn(() => true) }))

// Client components — never executed by the RSC (JSX construction only), but
// stubbed so their browser-oriented module graphs stay out of the test.
vi.mock("@/app/s/[slug]/survey-form", () => ({ SurveyForm: () => null }))
vi.mock("@/components/form-builder/public-form-widget", () => ({ PublicFormWidget: () => null }))
vi.mock("@/components/cobrowse/customer-widget", () => ({ CobrowseCustomerWidget: () => null }))
vi.mock("@/app/embed/chat/[key]/embed-chat-client", () => ({ EmbedChatClient: () => null }))

beforeEach(() => {
  seen.length = 0
})

describe("/s/[slug] — survey page two-phase", () => {
  it("publicSlug resolution runs bypass; prior-response lookup runs tenant-scoped", async () => {
    const { default: Page } = await import("@/app/s/[slug]/page")
    await Page({
      params: Promise.resolve({ slug: "sl" }),
      searchParams: Promise.resolve({ e: "a@b.c" }),
    })
    expect(ctxOf("survey.findUnique")).toEqual([{ bypass: true }])               // phase 1
    expect(ctxOf("surveyResponse.findFirst")).toEqual([{ orgId: "org1" }])       // phase 2
  })
})

describe("/s/unsubscribe — link-id two-phase", () => {
  it("survey-by-id resolution runs bypass; unsubscribe read/write runs tenant-scoped", async () => {
    const { default: Page } = await import("@/app/s/unsubscribe/page")
    await Page({ searchParams: Promise.resolve({ s: "sv1", e: "User@B.c", t: "tok" }) })
    expect(ctxOf("survey.findUnique")).toEqual([{ bypass: true }])               // phase 1
    expect(ctxOf("surveyUnsubscribe.findFirst")).toEqual([{ orgId: "org1" }])    // phase 2
    expect(ctxOf("surveyUnsubscribe.create")).toEqual([{ orgId: "org1" }])       // phase 2
  })
})

describe("/f/[slug] — org from URL, tenant-only (no bypass anywhere)", () => {
  it("form lookup AND view counter run tenant-scoped under the caller-supplied org", async () => {
    const { default: Page } = await import("@/app/f/[slug]/page")
    await Page({
      params: Promise.resolve({ slug: "fs" }),
      searchParams: Promise.resolve({ org: "org1" }),
    })
    expect(ctxOf("formDefinition.findUnique")).toEqual([{ orgId: "org1" }])      // lookup, NOT bypass
    expect(ctxOf("formDefinition.update")).toEqual([{ orgId: "org1" }])          // fire-and-forget counter
    expect(seen.some((s) => s.ctx?.bypass)).toBe(false)                          // zero bypass on this page
  })
})

describe("/c/[token] — cobrowse customer page", () => {
  it("joinToken resolution runs bypass (only query on the page)", async () => {
    const { default: Page } = await import("@/app/c/[token]/page")
    await Page({ params: Promise.resolve({ token: "tok_x" }) })
    expect(ctxOf("cobrowseSession.findUnique")).toEqual([{ bypass: true }])      // phase 1; render tenant-wrapped
  })
})

describe("/embed/chat/[key] — chat widget page", () => {
  it("publicKey resolution runs bypass (only query on the page)", async () => {
    const { default: Page } = await import("@/app/embed/chat/[key]/page")
    await Page({
      params: Promise.resolve({ key: "k1" }),
      searchParams: Promise.resolve({}),
    })
    expect(ctxOf("webChatWidget.findUnique")).toEqual([{ bypass: true }])        // phase 1; render tenant-wrapped
  })
})
