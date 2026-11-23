/**
 * «Комментарии» of Omni-Channel on a real Postgres, connected as an application role without
 * BYPASSRLS, the tables under the standard tenant policy — the real comment ingest, the real routes
 * and the real send; only the browser session and Meta's HTTP are stubbed.
 *
 *  - A comment one organization received is not in another organization's section, by list or by
 *    counter, and another organization cannot answer it. A page an administrator hid from a person
 *    is not in that person's section either.
 *  - A comment is «answered» once a delivered answer names it; a failed send is not an answer.
 *  - «A word in a comment → a ready message in Direct» (lib/inbox/comment-keyword-rules): the word,
 *    in any case and without Azerbaijani diacritics, sends the rule's text as the comment's private
 *    reply — once per person per rule per day, never into a conversation whose automatic replies are
 *    off, never by another organization's rule, and never for a comment without the word.
 *  - Only an administrator writes rules, and a rule cannot name another organization's page.
 *
 * Set INBOX_COMMENTS_BOARD_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   INBOX_COMMENTS_BOARD_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the deploy («Inbox comments
 * board database gate»), where `INBOX_COMMENTS_BOARD_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest, NextResponse } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { BoardPost } from "@/lib/inbox/comments-board"
import type { CommentKeywordRule } from "@/lib/inbox/comment-keyword-model"

const adminUrl = process.env.INBOX_COMMENTS_BOARD_TEST_DATABASE_URL
if (!adminUrl && process.env.INBOX_COMMENTS_BOARD_DB_GATE === "required") {
  throw new Error("INBOX_COMMENTS_BOARD_TEST_DATABASE_URL is required by the inbox comments board database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.INBOX_COMMENTS_BOARD_TEST_DATABASE_URL
  if (!admin) return null
  const name = `inbox_comments_${process.pid}_${Date.now()}`
  const role = `${name}_app`
  const db = new URL(admin)
  db.pathname = `/${name}`
  const app = new URL(db)
  app.username = role
  app.password = "inbox-comments-fixture-only"
  process.env.DATABASE_URL = app.toString()
  process.env.TENANT_PII_MASTER_KEY = "0123456789abcdef".repeat(4) // gitleaks:allow — synthetic test key
  return { name, role, adminDb: db.toString() }
})

const browser = vi.hoisted(() => ({
  current: null as null | {
    orgId: string; userId: string; role: string; email: string; name: string
    principalType: "session"; hiddenChannelConfigIds?: string[]
  },
}))
vi.mock("@/lib/api-auth", () => {
  const unauthorized = () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
  return {
    getOrgId: vi.fn(async () => browser.current?.orgId ?? null),
    getSession: vi.fn(async () => browser.current),
    requireAuth: vi.fn(async () => browser.current ?? unauthorized()),
    requireSessionAuth: vi.fn(async () => browser.current ?? unauthorized()),
    isAuthError: (value: unknown) => value instanceof Response,
    orgHasModule: vi.fn(async () => true),
    moduleDisabledResponse: vi.fn(() => NextResponse.json({ error: "Forbidden" }, { status: 403 })),
  }
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const RLS_TABLES = ["social_conversations", "channel_messages", "channel_configs", "audit_logs", "facebook_page_comments"]

const ORG = "org-comments"
const OTHER = "org-comments-other"
const ADMIN = "user-cm-admin"
const SELLER = "user-cm-seller" // an admin hid the second Instagram page from this one
const OTHER_ADMIN = "user-cm-other-admin"
const IG_MAIN = "cfg-cm-ig-main"
const IG_SECOND = "cfg-cm-ig-second"
const IG_OTHER = "cfg-cm-ig-other"
const FB_MAIN = "cfg-cm-fb-main"
const FB_SECOND = "cfg-cm-fb-second"
const FB_OTHER = "cfg-cm-fb-other"
const REEL = "media-reel-gece"
const POST = "media-post-price"
const SECOND_POST = "media-second-page"
const OTHER_REEL = "media-other-org"

function cli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env, timeout: 240_000, maxBuffer: 16 * 1024 * 1024 })
  if (result.status !== 0) {
    throw new Error(`prisma ${args[0]} failed: ${String(result.stderr || result.stdout || result.error).replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[test database]")}`)
  }
}
const sql = (url: string, statement: string) => cli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const file = path.join(mkdtempSync(path.join(tmpdir(), "inbox-comments-schema-")), "schema.prisma")
  writeFileSync(file, schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n"))
  return file
}

function tenantPolicy(table: string): string {
  return `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "${table}"
  USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on');`
}

type Board = { posts: BoardPost[]; channels: Array<{ id: string; name: string }>; rules: CommentKeywordRule[]; canManageRules: boolean }
type MetaCall = { url: string; body: Record<string, unknown>; raw: string }

;(scratch ? describe : describe.skip)("comments under the company's posts — on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let rls!: typeof import("@/lib/rls-context")
  let ingest!: typeof import("@/lib/inbox/instagram-comment-ingest")
  let boardRoute!: typeof import("@/app/api/v1/inbox/comments/route")
  let rulesRoute!: typeof import("@/app/api/v1/inbox/comments/keyword-rules/route")
  let inbox!: typeof import("@/app/api/v1/inbox/route")
  let facebook!: typeof import("@/lib/social/facebook-comments")
  let fbIngest!: typeof import("@/lib/inbox/facebook-comment-ingest")
  let fbReplyRoute!: typeof import("@/app/api/v1/inbox/comments/facebook/[id]/reply/route")
  let inboxChannel!: typeof import("@/lib/social/inbox-channel")
  let createdDb = false
  let createdRole = false
  /** Every request that left for Meta. */
  let meta: MetaCall[] = []
  /** What Meta answers a send with; a test may make it refuse. */
  let metaRefuses = false
  /** The Page subscription is refused when it asks for `feed` — a token without the permission. */
  let metaRefusesFeed = false

  const as = (orgId: string, userId: string, role = "admin", hiddenChannelConfigIds?: string[]) => {
    browser.current = { orgId, userId, role, email: `${userId}@example.test`, name: userId, principalType: "session", hiddenChannelConfigIds }
  }
  const bypass = <T,>(fn: () => Promise<T>): Promise<T> => rls.runWithRlsBypass(fn) as Promise<T>
  const request = (url: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  })

  async function board(): Promise<Board> {
    const res = await boardRoute.GET(request("/api/v1/inbox/comments"), undefined as never)
    expect(res.status).toBe(200)
    return (await res.json()).data as Board
  }
  const texts = (b: Board) => b.posts.flatMap((p) => p.comments.map((c) => c.text)).sort()
  const comment = (b: Board, text: string) => b.posts.flatMap((p) => p.comments).find((c) => c.text === text)

  let seq = 0
  /** A comment arriving by webhook, through the real ingest, inside its organization's scope. */
  async function arrives(org: string, channelId: string, account: string, from: string, text: string, mediaId: string) {
    const commentId = `comment-${++seq}`
    const result = await rls.runWithTenant(org, () => ingest.ingestInstagramComment({
      channel: { id: channelId, organizationId: org, apiKey: `token-${channelId}`, pageId: account, settings: { igLogin: true, username: account } },
      accountId: account,
      comment: { commentId, fromId: `igsid-${from}`, username: from, text, mediaId, mediaProductType: "REELS", parentId: null },
      seams: {
        fetchPostInfo: async () => ({ caption: `caption of ${mediaId}`, permalink: `https://www.instagram.com/reel/${mediaId}/`, mediaType: "VIDEO", imageUrl: null }),
        retryDelaysMs: [],
      },
    }))
    return { commentId, result }
  }
  const privateReplies = () => meta.filter((call) => call.url.includes("/me/messages"))
  const publicReplies = () => meta.filter((call) => call.url.includes("/replies"))

  /** A Page comment as Meta sends it, through the real parser and ingest. */
  async function pageComment(org: string, channelId: string, page: string, value: Record<string, unknown>) {
    const commentId = String(value.comment_id ?? `fb-comment-${++seq}`)
    const events = facebook.facebookCommentEvents({
      id: page,
      changes: [{ field: "feed", value: { item: "comment", verb: "add", post_id: `${page}_post`, parent_id: `${page}_post`, created_time: Math.floor(Date.now() / 1000), ...value, comment_id: commentId } }],
    })
    expect(events).toHaveLength(1)
    const result = await rls.runWithTenant(org, () => fbIngest.ingestFacebookComment({
      channel: { id: channelId, organizationId: org, apiKey: `token-${channelId}`, pageId: page },
      pageId: page,
      event: events[0],
      seams: {
        fetchPostInfo: async () => ({ caption: `page post of ${page}`, permalink: `https://www.facebook.com/${page}/posts/1`, imageUrl: null, isVideo: true }),
        retryDelaysMs: [],
      },
    }))
    return { commentId, result }
  }
  const fbReply = (id: string, mode: "public" | "private", text: string) => fbReplyRoute.POST(
    request(`/api/v1/inbox/comments/facebook/${id}/reply`, "POST", { mode, body: text }),
    { params: Promise.resolve({ id }) } as never,
  )

  async function saveRules(rules: unknown[]) {
    return rulesRoute.PUT(request("/api/v1/inbox/comments/keyword-rules", "PUT", { rules }), undefined as never)
  }

  beforeAll(async () => {
    sql(adminUrl!, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD 'inbox-comments-fixture-only' NOSUPERUSER NOBYPASSRLS`)
    createdRole = true
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    createdDb = true
    cli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminDb })
    sql(scratch!.adminDb, RLS_TABLES.map(tenantPolicy).join("\n"))
    sql(scratch!.adminDb, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)

    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input)
      let body: Record<string, unknown> = {}
      try { body = JSON.parse(String(init?.body ?? "{}")) } catch { /* not JSON */ }
      const raw = init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? "")
      meta.push({ url: url.replace(/access_token=[^&]+/, "access_token=…"), body, raw })
      if (url.includes("/subscribed_apps")) {
        return metaRefusesFeed && raw.includes("feed")
          ? new Response(JSON.stringify({ error: { message: "needs permission", code: 200 } }), { status: 403 })
          : new Response(JSON.stringify({ success: true }), { status: 200 })
      }
      if (metaRefuses) return new Response(JSON.stringify({ error: { message: "refused", code: 100 } }), { status: 400 })
      if (url.endsWith("/comments")) return new Response(JSON.stringify({ id: `fb-reply-${meta.length}` }), { status: 200 })
      return new Response(JSON.stringify(url.includes("/replies") ? { id: `reply-${meta.length}` } : { message_id: `mid-${meta.length}`, recipient_id: "psid-farid" }), { status: 200 })
    }))

    prisma = (await import("@/lib/prisma")).prisma
    rls = await import("@/lib/rls-context")
    ingest = await import("@/lib/inbox/instagram-comment-ingest")
    boardRoute = await import("@/app/api/v1/inbox/comments/route")
    rulesRoute = await import("@/app/api/v1/inbox/comments/keyword-rules/route")
    inbox = await import("@/app/api/v1/inbox/route")
    facebook = await import("@/lib/social/facebook-comments")
    fbIngest = await import("@/lib/inbox/facebook-comment-ingest")
    fbReplyRoute = await import("@/app/api/v1/inbox/comments/facebook/[id]/reply/route")
    inboxChannel = await import("@/lib/social/inbox-channel")

    await bypass(async () => {
      for (const id of [ORG, OTHER]) await prisma.organization.create({ data: { id, name: id, slug: id } })
      const people: Array<[string, string, string]> = [[ADMIN, ORG, "admin"], [SELLER, ORG, "sales"], [OTHER_ADMIN, OTHER, "admin"]]
      for (const [id, organizationId, role] of people) {
        await prisma.user.create({ data: { id, organizationId, email: `${id}@example.test`, name: id, role, passwordHash: "x" } })
      }
      await prisma.channelConfig.createMany({
        data: [
          { id: IG_MAIN, organizationId: ORG, channelType: "instagram", configName: "@leaddrive.az", pageId: "leaddrive.az", apiKey: `token-${IG_MAIN}`, settings: { igLogin: true } },
          { id: IG_SECOND, organizationId: ORG, channelType: "instagram", configName: "@second.page", pageId: "second.page", apiKey: `token-${IG_SECOND}`, settings: { igLogin: true } },
          { id: IG_OTHER, organizationId: OTHER, channelType: "instagram", configName: "@other.company", pageId: "other.company", apiKey: `token-${IG_OTHER}`, settings: { igLogin: true } },
          { id: FB_MAIN, organizationId: ORG, channelType: "facebook", configName: "Lead Drive CRM", pageId: "page-main", apiKey: `token-${FB_MAIN}`, settings: { commentsGranted: true } },
          { id: FB_SECOND, organizationId: ORG, channelType: "facebook", configName: "Second Page", pageId: "page-second", apiKey: `token-${FB_SECOND}`, settings: { commentsGranted: true } },
          { id: FB_OTHER, organizationId: OTHER, channelType: "facebook", configName: "Other Page", pageId: "page-other", apiKey: `token-${FB_OTHER}`, settings: { commentsGranted: true } },
        ],
      })
    })
  }, 300_000)

  beforeEach(() => {
    meta = []
    metaRefuses = false
    metaRefusesFeed = false
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await prisma?.$disconnect()
    if (createdDb) sql(adminUrl!, `DROP DATABASE "${scratch!.name}" WITH (FORCE)`)
    if (createdRole) sql(adminUrl!, `DROP ROLE "${scratch!.role}"`)
  }, 60_000)

  it("keeps the tables under FORCE RLS with the standard tenant policy", async () => {
    const tables = await bypass(() => prisma.$queryRaw<Array<{ relname: string; forced: boolean }>>`
      SELECT relname, relforcerowsecurity AS forced FROM pg_class WHERE relname = ANY(${RLS_TABLES}) ORDER BY relname`)
    expect(tables).toEqual([...RLS_TABLES].sort().map((relname) => ({ relname, forced: true })))
  })

  it("shows an organization its own comments grouped by post, and nobody else's", async () => {
    expect((await arrives(ORG, IG_MAIN, "leaddrive.az", "aysel", "Qiymət nə qədərdir?", POST)).result).toBe("stored")
    await arrives(ORG, IG_MAIN, "leaddrive.az", "nigar", "Əla məhsuldur", POST)
    await arrives(ORG, IG_SECOND, "second.page", "kamran", "Çatdırılma var?", SECOND_POST)
    await arrives(OTHER, IG_OTHER, "other.company", "stranger", "Başqa şirkətə sual", OTHER_REEL)
    // A Direct message is not a comment and has no place in the section.
    await bypass(() => prisma.channelMessage.create({
      data: { organizationId: ORG, channelConfigId: IG_MAIN, channelType: "instagram", direction: "inbound", from: "igsid-aysel", to: "leaddrive.az", body: "Direct-də yazıram", metadata: {} },
    }))

    as(ORG, ADMIN)
    const mine = await board()
    expect(texts(mine)).toEqual(["Qiymət nə qədərdir?", "Çatdırılma var?", "Əla məhsuldur"].sort())
    const post = mine.posts.find((p) => p.key === `${IG_MAIN}:${POST}`)!
    expect(post).toMatchObject({ channelName: "@leaddrive.az", caption: `caption of ${POST}`, total: 2, unanswered: 2, isReel: true })
    expect(post.permalink).toBe(`https://www.instagram.com/reel/${POST}/`)
    expect(mine.channels.map((c) => c.id).sort()).toEqual([IG_MAIN, IG_SECOND, FB_MAIN, FB_SECOND].sort())
    expect(mine.canManageRules).toBe(true)

    as(OTHER, OTHER_ADMIN)
    const theirs = await board()
    expect(texts(theirs)).toEqual(["Başqa şirkətə sual"])
    expect(theirs.channels.map((c) => c.id).sort()).toEqual([IG_OTHER, FB_OTHER].sort())
    // Nothing was sent to anybody: none of these comments carries a rule's word.
    expect(meta).toEqual([])
  })

  it("leaves out the page an administrator hid from this person — list, pages and counters", async () => {
    as(ORG, SELLER, "sales", [IG_SECOND, FB_MAIN, FB_SECOND])
    const seen = await board()
    expect(texts(seen)).toEqual(["Qiymət nə qədərdir?", "Əla məhsuldur"].sort())
    expect(seen.channels.map((c) => c.id)).toEqual([IG_MAIN])
    expect(seen.posts.every((p) => p.channelConfigId === IG_MAIN)).toBe(true)
    expect(seen.canManageRules).toBe(false)
  })

  it("lets only an administrator write rules, and never for another organization's page", async () => {
    as(ORG, SELLER, "sales")
    expect((await saveRules([{ keyword: "GECƏ", message: "Salam!" }])).status).toBe(403)

    as(ORG, ADMIN)
    const foreign = await saveRules([{ keyword: "GECƏ", message: "Salam!", channelConfigId: IG_OTHER }])
    expect(foreign.status).toBe(400)
    expect((await foreign.json()).error).toBe("unknown_channel")
    const twice = await saveRules([{ keyword: "GECƏ", message: "bir" }, { keyword: "gece", message: "iki" }])
    expect((await twice.json()).error).toBe("duplicate_keyword")
    expect((await board()).rules).toEqual([])

    const saved = await saveRules([{ keyword: "GECƏ", message: "Salam! Gecə növbəsi haqqında məlumat göndəririk." }])
    expect(saved.status).toBe(200)
    expect((await board()).rules.map((r) => r.keyword)).toEqual(["GECƏ"])

    as(OTHER, OTHER_ADMIN)
    expect((await board()).rules).toEqual([])
  })

  it("answers the rule's word in Direct once — whatever the spelling — and marks the comment answered", async () => {
    const first = await arrives(ORG, IG_MAIN, "leaddrive.az", "elvin", "gece 🙏", REEL)
    expect(privateReplies()).toHaveLength(1)
    expect(privateReplies()[0].url).toContain("graph.instagram.com")
    expect(privateReplies()[0].body).toEqual({
      recipient: { comment_id: first.commentId },
      message: { text: "Salam! Gecə növbəsi haqqında məlumat göndəririk." },
    })

    as(ORG, ADMIN)
    const answered = comment(await board(), "gece 🙏")!
    expect(answered).toMatchObject({ answered: true, keyword: "GECƏ", privateReplyAvailable: false })
    expect(answered.replies).toHaveLength(1)
    expect(answered.replies[0]).toMatchObject({ mode: "private", keyword: "GECƏ", authorName: null })

    // The same person repeats the word under the same reel: nothing more goes to them today.
    await arrives(ORG, IG_MAIN, "leaddrive.az", "elvin", "GECƏ!!!", REEL)
    expect(privateReplies()).toHaveLength(1)
    expect(comment(await board(), "GECƏ!!!")).toMatchObject({ answered: false, keyword: "GECƏ" })

    // Another person gets their own message; a longer word that only starts the same does not count.
    await arrives(ORG, IG_MAIN, "leaddrive.az", "sevda", "Gecə", REEL)
    expect(privateReplies()).toHaveLength(2)
    await arrives(ORG, IG_MAIN, "leaddrive.az", "tural", "gecələr işləyirsiniz?", REEL)
    expect(privateReplies()).toHaveLength(2)
    expect(comment(await board(), "gecələr işləyirsiniz?")).toMatchObject({ answered: false, keyword: null })
  })

  it("stays silent where automatic replies are switched off, and for another organization's page", async () => {
    await arrives(ORG, IG_MAIN, "leaddrive.az", "quiet", "salam", REEL)
    await bypass(() => prisma.socialConversation.updateMany({
      where: { organizationId: ORG, externalId: "igsid-quiet" },
      data: { autoReplyOffAt: new Date(), autoReplyOffBy: ADMIN },
    }))
    await arrives(ORG, IG_MAIN, "leaddrive.az", "quiet", "GECƏ", REEL)
    // The other organization has no rule; the first organization's rule is not theirs.
    await arrives(OTHER, IG_OTHER, "other.company", "stranger2", "GECƏ", OTHER_REEL)
    expect(meta).toEqual([])

    as(OTHER, OTHER_ADMIN)
    expect(comment(await board(), "GECƏ")).toMatchObject({ answered: false, keyword: null })
  })

  it("does not call a refused send an answer", async () => {
    metaRefuses = true
    await arrives(ORG, IG_MAIN, "leaddrive.az", "unlucky", "gecə", REEL)
    expect(privateReplies()).toHaveLength(1)
    as(ORG, ADMIN)
    expect(comment(await board(), "gecə")).toMatchObject({ answered: false, privateReplyAvailable: true })
  })

  it("answers under the post from the section, and refuses another organization's comment", async () => {
    as(ORG, ADMIN)
    const before = comment(await board(), "Qiymət nə qədərdir?")!
    expect(before.answered).toBe(false)

    as(OTHER, OTHER_ADMIN)
    const stolen = await inbox.POST(request("/api/v1/inbox", "POST", {
      to: before.author, body: "Biz cavab veririk", channel: "instagram",
      conversationId: before.conversationId, commentReply: { messageId: before.id, mode: "public" },
    }), undefined as never)
    expect(stolen.status).toBe(404)
    expect(meta).toEqual([])

    as(ORG, ADMIN)
    const sent = await inbox.POST(request("/api/v1/inbox", "POST", {
      to: before.author, body: "Qiymətləri Direct-ə göndərdik", channel: "instagram",
      conversationId: before.conversationId, commentReply: { messageId: before.id, mode: "public" },
    }), undefined as never)
    expect(sent.status).toBe(201)
    expect(publicReplies()).toHaveLength(1)
    expect(publicReplies()[0].body).toEqual({ message: "Qiymətləri Direct-ə göndərdik" })

    const after = comment(await board(), "Qiymət nə qədərdir?")!
    expect(after.answered).toBe(true)
    expect(after.replies[0]).toMatchObject({ mode: "public", text: "Qiymətləri Direct-ə göndərdik", authorName: ADMIN, keyword: null })
    const post = (await board()).posts.find((p) => p.key === `${IG_MAIN}:${POST}`)!
    expect(post).toMatchObject({ total: 2, unanswered: 1 })
  })

  describe("Facebook Page comments", () => {
    it("shows a Page comment in its organization only, and writes nothing the AI or the inbox would read", async () => {
      const before = await bypass(() => prisma.channelMessage.count())
      const conversations = await bypass(() => prisma.socialConversation.count())
      expect((await pageComment(ORG, FB_MAIN, "page-main", { message: "Bu nə qədərdir?", from: { id: "fb-user-farid", name: "Fərid" } })).result).toBe("stored")
      await pageComment(ORG, FB_SECOND, "page-second", { message: "İkinci səhifəyə sual", from: { id: "fb-user-2", name: "Ləman" } })
      await pageComment(OTHER, FB_OTHER, "page-other", { message: "Başqa şirkətin şərhi", from: { id: "fb-user-3", name: "Yad" } })
      expect(await bypass(() => prisma.channelMessage.count())).toBe(before)
      expect(await bypass(() => prisma.socialConversation.count())).toBe(conversations)

      as(ORG, ADMIN)
      const mine = await board()
      expect(comment(mine, "Bu nə qədərdir?")).toMatchObject({ platform: "facebook", author: "Fərid", answered: false, privateReplyAvailable: true, conversationId: null })
      expect(comment(mine, "Başqa şirkətin şərhi")).toBeUndefined()
      expect(mine.posts.find((p) => p.key === `${FB_MAIN}:page-main_post`)).toMatchObject({ platform: "facebook", channelName: "Lead Drive CRM", caption: "page post of page-main", isReel: true })
      expect(mine.channels.map((c) => c.id)).toEqual(expect.arrayContaining([FB_MAIN, FB_SECOND]))

      as(ORG, SELLER, "sales", [FB_SECOND])
      const seller = await board()
      expect(comment(seller, "İkinci səhifəyə sual")).toBeUndefined()
      expect(comment(seller, "Bu nə qədərdir?")).toBeDefined()

      as(OTHER, OTHER_ADMIN)
      const theirs = await board()
      expect(comment(theirs, "Başqa şirkətin şərhi")).toBeDefined()
      expect(comment(theirs, "Bu nə qədərdir?")).toBeUndefined()
      expect(meta).toEqual([])
    })

    it("refuses an answer from another organization or to a hidden Page, and sends under the post for its own", async () => {
      as(ORG, ADMIN)
      const mine = await board()
      const target = comment(mine, "Bu nə qədərdir?")!
      const hidden = comment(mine, "İkinci səhifəyə sual")!

      as(OTHER, OTHER_ADMIN)
      expect((await fbReply(target.id, "public", "Biz cavab veririk")).status).toBe(404)
      as(ORG, SELLER, "sales", [FB_SECOND])
      expect((await fbReply(hidden.id, "public", "Gizli")).status).toBe(404)
      expect(meta).toEqual([])

      as(ORG, ADMIN)
      expect((await fbReply(target.id, "public", "Qiymət 10 AZN-dir")).status).toBe(201)
      expect(meta).toHaveLength(1)
      expect(meta[0].url).toContain(`/${(await bypass<{ commentId: string }>(() => prisma.facebookPageComment.findFirst({ where: { id: target.id } }))).commentId}/comments`)
      const after = comment(await board(), "Bu nə qədərdir?")!
      expect(after).toMatchObject({ answered: true, privateReplyAvailable: true })
      expect(after.replies[0]).toMatchObject({ mode: "public", text: "Qiymət 10 AZN-dir", authorName: ADMIN })
    })

    it("does not double our own reply when Meta echoes it, and shows one typed on Facebook", async () => {
      as(ORG, ADMIN)
      const row = await bypass<{ commentId: string }>(() => prisma.facebookPageComment.findFirst({ where: { body: "Bu nə qədərdir?" } }))
      expect((await pageComment(ORG, FB_MAIN, "page-main", { message: "Qiymət 10 AZN-dir", parent_id: row.commentId, from: { id: "page-main", name: "Lead Drive CRM" } })).result).toBe("duplicate")
      expect((await pageComment(ORG, FB_MAIN, "page-main", { message: "Facebook-dan yazdım", parent_id: row.commentId, from: { id: "page-main", name: "Lead Drive CRM" } })).result).toBe("own_reply_stored")
      const shown = comment(await board(), "Bu nə qədərdir?")!
      expect(shown.replies.map((r) => [r.text, r.fromApp]).sort()).toEqual([["Facebook-dan yazdım", true], ["Qiymət 10 AZN-dir", false]])
      // The Page's own comment is not a customer's.
      expect(comment(await board(), "Facebook-dan yazdım")).toBeUndefined()
    })

    it("spends the private reply once, gives it back on a refusal, and ties the comment to the Messenger thread", async () => {
      as(ORG, ADMIN)
      const target = comment(await board(), "Bu nə qədərdir?")!
      metaRefuses = true
      expect((await fbReply(target.id, "private", "Salam")).status).toBe(502)
      expect(comment(await board(), "Bu nə qədərdir?")!.privateReplyAvailable).toBe(true)
      metaRefuses = false
      meta = []

      expect((await fbReply(target.id, "private", "Salam, Messenger-də yazırıq")).status).toBe(201)
      expect(privateReplies()[0].body).toMatchObject({ message: { text: "Salam, Messenger-də yazırıq" } })
      const after = comment(await board(), "Bu nə qədərdir?")!
      expect(after.privateReplyAvailable).toBe(false)
      expect(after.conversationId).toBeTruthy()
      const thread = await bypass(() => prisma.socialConversation.findFirst({ where: { id: after.conversationId! } }))
      expect(thread).toMatchObject({ organizationId: ORG, platform: "facebook", externalId: "psid-farid", channelConfigId: FB_MAIN })
      const row = await bypass(() => prisma.channelMessage.findFirst({ where: { conversationId: after.conversationId!, direction: "outbound" } }))
      expect(row).toMatchObject({ body: "Salam, Messenger-də yazırıq", to: "psid-farid", status: "sent" })

      meta = []
      const again = await fbReply(target.id, "private", "İkinci dəfə")
      expect(again.status).toBe(409)
      expect((await again.json()).error).toBe("private_reply_used")
      expect(meta).toEqual([])
    })

    it("sends a rule's message once per person, and never for a comment whose author Meta left out", async () => {
      expect((await pageComment(ORG, FB_MAIN, "page-main", { message: "gece", from: { id: "fb-user-word", name: "Söz" } })).result).toBe("stored")
      expect(privateReplies()).toHaveLength(1)
      expect(privateReplies()[0].body).toMatchObject({ message: { text: "Salam! Gecə növbəsi haqqında məlumat göndəririk." } })
      await pageComment(ORG, FB_MAIN, "page-main", { message: "GECƏ yenə", from: { id: "fb-user-word", name: "Söz" } })
      expect(privateReplies()).toHaveLength(1)
      await pageComment(ORG, FB_MAIN, "page-main", { message: "Gecə anonim" })
      expect(privateReplies()).toHaveLength(1)
      as(ORG, ADMIN)
      const answered = comment(await board(), "gece")!
      expect(answered.replies[0]).toMatchObject({ mode: "private", keyword: "GECƏ", authorName: null })
      expect(comment(await board(), "Gecə anonim")).toMatchObject({ answered: false, author: "Facebook" })
      // Another organization's Page has no rule.
      meta = []
      await pageComment(OTHER, FB_OTHER, "page-other", { message: "GECƏ", from: { id: "fb-user-4", name: "Yad" } })
      expect(meta).toEqual([])
    })

    it("takes a comment off the screen when it is deleted, and follows an edit", async () => {
      const { commentId } = await pageComment(ORG, FB_MAIN, "page-main", { message: "Silinəcək", from: { id: "fb-user-5", name: "Beş" } })
      await pageComment(ORG, FB_MAIN, "page-main", { comment_id: commentId, verb: "edited", message: "Düzəldilib", from: { id: "fb-user-5", name: "Beş" } })
      as(ORG, ADMIN)
      expect(comment(await board(), "Düzəldilib")).toBeDefined()
      await pageComment(ORG, FB_MAIN, "page-main", { comment_id: commentId, verb: "remove", from: { id: "fb-user-5", name: "Beş" } })
      expect(comment(await board(), "Düzəldilib")).toBeUndefined()
    })

    it("keeps Messenger when Meta refuses the comment subscription, and does not offer the Page", async () => {
      metaRefusesFeed = true
      const wired = await rls.runWithTenant(ORG, () => inboxChannel.ensureInboxChannelForPage(ORG, "facebook", "page-third", "Third Page", "token-third", { comments: true }))
      expect(wired.subscribed).toBe(true)
      expect(meta.filter((c) => c.url.includes("/subscribed_apps")).map((c) => c.raw.includes("feed"))).toEqual([true, false])
      const row = await bypass<{ settings: unknown }>(() => prisma.channelConfig.findFirst({ where: { id: wired.channelId! } }))
      expect(row.settings).toMatchObject({ inboxSubscribed: true, commentsGranted: false })
      as(ORG, ADMIN)
      expect((await board()).channels.map((c) => c.id)).not.toContain(wired.channelId)

      metaRefusesFeed = false
      meta = []
      await rls.runWithTenant(ORG, () => inboxChannel.ensureInboxChannelForPage(ORG, "facebook", "page-third", "Third Page", "token-third", { comments: true }))
      expect((await board()).channels.map((c) => c.id)).toContain(wired.channelId)
      // An ordinary reconnect is a Messenger-only token: it no longer claims comments.
      await rls.runWithTenant(ORG, () => inboxChannel.ensureInboxChannelForPage(ORG, "facebook", "page-third", "Third Page", "token-third"))
      expect((await board()).channels.map((c) => c.id)).not.toContain(wired.channelId)
    })
  })
})
