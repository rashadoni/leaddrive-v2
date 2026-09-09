import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  socialMention: { findMany: vi.fn() },
  mentionEvidence: { findMany: vi.fn() },
}))

vi.mock("@/lib/prisma", () => ({ prisma: db }))

import { parentMatchContextsForComments } from "@/lib/social/parent-match-context"

type SubjectMatch = {
  subjectId: string
  status?: "MATCHED" | "REJECTED"
  reason?: string
}
type MentionFixture = {
  organizationId: string
  platform: string
  contentKind: string
  id: string
  externalId?: string
  postExternalId?: string | null
  url: string | null
  canonicalUrl: string | null
  matchedTerm: string | null
  sentiment?: string | null
  text?: string | null
  deletedAtSource?: Date | null
  purgedAt?: Date | null
  subjectMatches: SubjectMatch[]
}
type EvidenceFixture = {
  organizationId: string
  permalink: string | null
  mention: Omit<MentionFixture, "organizationId" | "url" | "canonicalUrl">
}
type MentionFindManyInput = {
  where: {
    organizationId: string
    platform: string
    contentKind: { notIn: string[] }
    OR: Array<{
      url?: { in: string[] }
      canonicalUrl?: { in: string[] }
      externalId?: { in: string[] }
      postExternalId?: { in: string[] }
    }>
  }
  select: {
    subjectMatches: {
      where: {
        status?: string
        OR?: Array<{ status: string; reason?: { startsWith: string } }>
      }
    }
  }
}
type EvidenceFindManyInput = {
  where: { organizationId: string; permalink: { in: string[] } }
  select: {
    mention: {
      select: {
        subjectMatches: MentionFindManyInput["select"]["subjectMatches"]
      }
    }
  }
}

let mentionFixtures: MentionFixture[] = []
let evidenceFixtures: EvidenceFixture[] = []

function selectedSubjectMatches(
  matches: SubjectMatch[],
  where: MentionFindManyInput["select"]["subjectMatches"]["where"],
): SubjectMatch[] {
  const statusFor = (match: SubjectMatch) => match.status ?? "MATCHED"
  if (where.OR) {
    return matches.filter(match => where.OR!.some(condition => (
      statusFor(match) === condition.status
      && (
        !condition.reason
        || String(match.reason ?? "").startsWith(condition.reason.startsWith)
      )
    )))
  }
  return where.status
    ? matches.filter(match => statusFor(match) === where.status)
    : matches
}

beforeEach(() => {
  vi.clearAllMocks()
  mentionFixtures = []
  evidenceFixtures = []
  db.socialMention.findMany.mockImplementation(async (input: unknown) => {
    const query = input as MentionFindManyInput
    const wantedUrls = new Set(query.where.OR.flatMap(condition => condition.url?.in ?? []))
    const wantedCanonicalUrls = new Set(query.where.OR.flatMap(condition => condition.canonicalUrl?.in ?? []))
    const wantedExternalIds = new Set(query.where.OR.flatMap(condition => condition.externalId?.in ?? []))
    const wantedPostExternalIds = new Set(query.where.OR.flatMap(condition => condition.postExternalId?.in ?? []))
    return mentionFixtures
      .filter(row => row.organizationId === query.where.organizationId)
      .filter(row => row.platform === query.where.platform)
      .filter(row => !query.where.contentKind.notIn.includes(row.contentKind))
      .filter(row => (
        Boolean(row.url && wantedUrls.has(row.url))
        || Boolean(row.canonicalUrl && wantedCanonicalUrls.has(row.canonicalUrl))
        || Boolean(row.externalId && wantedExternalIds.has(row.externalId))
        || Boolean(row.postExternalId && wantedPostExternalIds.has(row.postExternalId))
      ))
      .filter(row => row.deletedAtSource == null && row.purgedAt == null)
      .map(({ id, externalId = id, postExternalId = null, url, canonicalUrl, matchedTerm, sentiment = null, text = null, subjectMatches }) => ({
        id,
        externalId,
        postExternalId,
        url,
        canonicalUrl,
        matchedTerm,
        sentiment,
        text,
        subjectMatches: selectedSubjectMatches(subjectMatches, query.select.subjectMatches.where),
      }))
  })
  db.mentionEvidence.findMany.mockImplementation(async (input: unknown) => {
    const query = input as EvidenceFindManyInput
    const wantedPermalinks = new Set(query.where.permalink.in)
    return evidenceFixtures
      .filter(row => row.organizationId === query.where.organizationId)
      .filter(row => Boolean(row.permalink && wantedPermalinks.has(row.permalink)))
      .map(({ permalink, mention }) => ({
        permalink,
        mention: {
          ...mention,
          externalId: mention.externalId ?? mention.id,
          postExternalId: mention.postExternalId ?? null,
          sentiment: mention.sentiment ?? null,
          text: mention.text ?? null,
          deletedAtSource: mention.deletedAtSource ?? null,
          purgedAt: mention.purgedAt ?? null,
          subjectMatches: selectedSubjectMatches(
            mention.subjectMatches,
            query.select.mention.select.subjectMatches.where,
          ),
        },
      }))
  })
})

describe("parent comment match context", () => {
  it("maps a canonical parent match back to every requested raw URL alias", async () => {
    mentionFixtures.push({
      organizationId: "org-1",
      platform: "tiktok",
      contentKind: "POST",
      id: "mention-1",
      url: "https://www.tiktok.com/@brand/video/1?utm_source=test",
      canonicalUrl: "https://tiktok.com/@brand/video/1",
      matchedTerm: "Brand",
      subjectMatches: [{ subjectId: "subject-1" }],
    })
    const rawRequestedUrl = "https://www.tiktok.com/@brand/video/1?comment_id=2&utm_source=comments"
    const canonicalRequestedUrl = "https://tiktok.com/@brand/video/1?comment_id=2"
    const parentIdentityUrl = "https://tiktok.com/@brand/video/1"

    const contexts = await parentMatchContextsForComments(
      "org-1",
      "tiktok",
      [rawRequestedUrl],
    )

    expect(db.socialMention.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        platform: "tiktok",
        contentKind: { notIn: ["COMMENT", "REPLY"] },
        OR: [
          { url: { in: expect.arrayContaining([rawRequestedUrl, canonicalRequestedUrl, parentIdentityUrl]) } },
          { canonicalUrl: { in: expect.arrayContaining([rawRequestedUrl, canonicalRequestedUrl, parentIdentityUrl]) } },
        ],
      }),
    }))
    const expected = {
      parentMentionId: "mention-1",
      matchedTerm: "Brand",
      subjectIds: ["subject-1"],
      parentSentiment: null,
      inheritAllCommentSubjectIds: [],
    }
    expect(contexts.get(rawRequestedUrl)).toEqual(expected)
    expect(contexts.get(canonicalRequestedUrl)).toEqual(expected)
    expect(contexts.get(parentIdentityUrl)).toEqual(expected)
  })

  it("normalizes Facebook mobile/tracking aliases but preserves post identity parameters", async () => {
    const parentIdentityUrl = "https://facebook.com/story.php?id=page-1&story_fbid=post-1"
    const rawRequestedUrl = "https://m.facebook.com/story.php?story_fbid=post-1&id=page-1&comment_id=comment-1&mibextid=tracking&utm_source=comments"
    mentionFixtures.push({
      organizationId: "org-1",
      platform: "facebook",
      contentKind: "POST",
      id: "mention-facebook",
      url: parentIdentityUrl,
      canonicalUrl: parentIdentityUrl,
      matchedTerm: "Brand",
      subjectMatches: [{ subjectId: "subject-facebook" }],
    })

    const contexts = await parentMatchContextsForComments("org-1", "facebook", [rawRequestedUrl])

    expect(contexts.get(rawRequestedUrl)).toMatchObject({
      parentMentionId: "mention-facebook",
      subjectIds: ["subject-facebook"],
    })
    expect(contexts.get(parentIdentityUrl)).toMatchObject({
      parentMentionId: "mention-facebook",
      subjectIds: ["subject-facebook"],
    })
    expect(parentIdentityUrl).toContain("id=page-1")
    expect(parentIdentityUrl).toContain("story_fbid=post-1")
  })

  it("uses an official-author rejection as verified parent context, but no other rejection", async () => {
    const officialUrl = "https://instagram.com/p/official-parent"
    const unrelatedRejectedUrl = "https://instagram.com/p/rejected-parent"
    mentionFixtures.push(
      {
        organizationId: "org-1",
        platform: "instagram",
        contentKind: "POST",
        id: "official-parent",
        url: officialUrl,
        canonicalUrl: officialUrl,
        matchedTerm: "Oba Market",
        subjectMatches: [{
          subjectId: "subject-oba",
          status: "REJECTED",
          reason: "official_author",
        }],
      },
      {
        organizationId: "org-1",
        platform: "instagram",
        contentKind: "POST",
        id: "unrelated-rejected-parent",
        url: unrelatedRejectedUrl,
        canonicalUrl: unrelatedRejectedUrl,
        matchedTerm: "Oba Market",
        subjectMatches: [{
          subjectId: "subject-oba",
          status: "REJECTED",
          reason: "weak_match",
        }],
      },
    )

    const contexts = await parentMatchContextsForComments(
      "org-1",
      "instagram",
      [officialUrl, unrelatedRejectedUrl],
    )

    expect(contexts.get(officialUrl)).toEqual({
      parentMentionId: "official-parent",
      matchedTerm: "Oba Market",
      subjectIds: ["subject-oba"],
      parentSentiment: null,
      inheritAllCommentSubjectIds: [],
    })
    expect(contexts.has(unrelatedRejectedUrl)).toBe(false)
    expect(db.socialMention.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        subjectMatches: {
          where: {
            OR: [
              { status: "MATCHED" },
              { status: "REJECTED", reason: { startsWith: "official_author" } },
            ],
          },
          select: { subjectId: true, status: true },
        },
      }),
    }))
  })

  it("does not cross tenant, platform, or comment-parent boundaries", async () => {
    const parentUrl = "https://tiktok.com/@brand/video/isolated"
    mentionFixtures.push(
      {
        organizationId: "org-2",
        platform: "tiktok",
        contentKind: "POST",
        id: "wrong-tenant",
        url: parentUrl,
        canonicalUrl: parentUrl,
        matchedTerm: "Brand",
        subjectMatches: [{ subjectId: "subject-wrong-tenant" }],
      },
      {
        organizationId: "org-1",
        platform: "instagram",
        contentKind: "POST",
        id: "wrong-platform",
        url: parentUrl,
        canonicalUrl: parentUrl,
        matchedTerm: "Brand",
        subjectMatches: [{ subjectId: "subject-wrong-platform" }],
      },
      {
        organizationId: "org-1",
        platform: "tiktok",
        contentKind: "COMMENT",
        id: "wrong-kind",
        url: parentUrl,
        canonicalUrl: parentUrl,
        matchedTerm: "Brand",
        subjectMatches: [{ subjectId: "subject-wrong-kind" }],
      },
    )

    await expect(parentMatchContextsForComments("org-1", "tiktok", [parentUrl]))
      .resolves.toEqual(new Map())
  })

  it("keeps the evidence fallback tenant/platform scoped", async () => {
    const parentUrl = "https://instagram.com/p/evidence-parent"
    evidenceFixtures.push(
      {
        organizationId: "org-2",
        permalink: parentUrl,
        mention: {
          platform: "instagram",
          contentKind: "POST",
          id: "evidence-wrong-tenant",
          matchedTerm: "Brand",
          subjectMatches: [{ subjectId: "subject-wrong-tenant" }],
        },
      },
      {
        organizationId: "org-1",
        permalink: parentUrl,
        mention: {
          platform: "facebook",
          contentKind: "POST",
          id: "evidence-wrong-platform",
          matchedTerm: "Brand",
          subjectMatches: [{ subjectId: "subject-wrong-platform" }],
        },
      },
      {
        organizationId: "org-1",
        permalink: parentUrl,
        mention: {
          platform: "instagram",
          contentKind: "COMMENT",
          id: "evidence-wrong-kind",
          matchedTerm: "Brand",
          subjectMatches: [{ subjectId: "subject-wrong-kind" }],
        },
      },
      {
        organizationId: "org-1",
        permalink: parentUrl,
        mention: {
          platform: "instagram",
          contentKind: "POST",
          id: "evidence-parent",
          matchedTerm: "Brand",
          subjectMatches: [{
            subjectId: "subject-correct",
            status: "REJECTED",
            reason: "official_author_profile",
          }],
        },
      },
    )

    const contexts = await parentMatchContextsForComments("org-1", "instagram", [parentUrl])

    expect(db.mentionEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", permalink: { in: expect.arrayContaining([parentUrl]) } },
    }))
    expect(new Set(Array.from(contexts.values(), context => context.parentMentionId)))
      .toEqual(new Set(["evidence-parent"]))
  })

  it("does not expose a matchedTerm-only parent as inheritable subject context", async () => {
    mentionFixtures.push({
      organizationId: "org-1",
      platform: "tiktok",
      contentKind: "POST",
      id: "mention-neutral",
      url: "https://tiktok.com/@other/video/2",
      canonicalUrl: "https://tiktok.com/@other/video/2",
      matchedTerm: "Brand",
      subjectMatches: [],
    })

    await expect(parentMatchContextsForComments(
      "org-1",
      "tiktok",
      ["https://tiktok.com/@other/video/2"],
    )).resolves.toEqual(new Map())
  })

  it("authorizes complete thread inheritance only for matched subjects on a negative parent", async () => {
    const parentUrl = "https://www.youtube.com/watch?v=negative-parent"
    mentionFixtures.push({
      organizationId: "org-1",
      platform: "youtube",
      contentKind: "VIDEO",
      id: "negative-parent",
      url: parentUrl,
      canonicalUrl: parentUrl,
      matchedTerm: "Brand",
      sentiment: "negative",
      subjectMatches: [
        { subjectId: "subject-matched", status: "MATCHED" },
        { subjectId: "subject-official", status: "REJECTED", reason: "official_author" },
      ],
    })

    const context = (await parentMatchContextsForComments("org-1", "youtube", [parentUrl])).get(parentUrl)

    expect(context).toEqual({
      parentMentionId: "negative-parent",
      matchedTerm: "Brand",
      subjectIds: ["subject-matched", "subject-official"],
      parentSentiment: "negative",
      inheritAllCommentSubjectIds: ["subject-matched"],
    })
  })

  it("prefers and merges a negative matched duplicate regardless of query order", async () => {
    const parentUrl = "https://www.youtube.com/watch?v=duplicate-parent"
    const neutral: MentionFixture = {
      organizationId: "org-1",
      platform: "youtube",
      contentKind: "VIDEO",
      id: "neutral-duplicate",
      url: parentUrl,
      canonicalUrl: parentUrl,
      matchedTerm: "Brand",
      sentiment: "neutral",
      subjectMatches: [{ subjectId: "subject-neutral", status: "MATCHED" }],
    }
    const negative: MentionFixture = {
      organizationId: "org-1",
      platform: "youtube",
      contentKind: "VIDEO",
      id: "negative-duplicate",
      url: parentUrl,
      canonicalUrl: parentUrl,
      matchedTerm: "Brand",
      sentiment: "negative",
      subjectMatches: [{ subjectId: "subject-negative", status: "MATCHED" }],
    }

    mentionFixtures.push(neutral, negative)
    const first = (await parentMatchContextsForComments("org-1", "youtube", [parentUrl])).get(parentUrl)
    mentionFixtures = [negative, neutral]
    const second = (await parentMatchContextsForComments("org-1", "youtube", [parentUrl])).get(parentUrl)

    const expected = {
      parentMentionId: "negative-duplicate",
      parentSentiment: "negative",
      subjectIds: ["subject-negative", "subject-neutral"],
      inheritAllCommentSubjectIds: ["subject-negative"],
    }
    expect(first).toMatchObject(expected)
    expect(second).toMatchObject(expected)
  })

  it("propagates a duplicate upgrade back to aliases learned from an earlier row", async () => {
    const firstAlias = "https://www.facebook.com/BrandPage/posts/42?ref=first"
    const sharedAlias = "https://facebook.com/BrandPage/posts/42"
    const laterAlias = "https://www.facebook.com/BrandPage/posts/42?ref=later"
    mentionFixtures.push(
      {
        organizationId: "org-1",
        platform: "facebook",
        contentKind: "POST",
        id: "neutral-alias-row",
        url: firstAlias,
        canonicalUrl: sharedAlias,
        matchedTerm: "Brand",
        sentiment: "neutral",
        subjectMatches: [{ subjectId: "subject-neutral", status: "MATCHED" }],
      },
      {
        organizationId: "org-1",
        platform: "facebook",
        contentKind: "POST",
        id: "negative-alias-row",
        url: sharedAlias,
        canonicalUrl: laterAlias,
        matchedTerm: "Brand",
        sentiment: "negative",
        subjectMatches: [{ subjectId: "subject-negative", status: "MATCHED" }],
      },
    )

    const contexts = await parentMatchContextsForComments(
      "org-1",
      "facebook",
      [firstAlias, laterAlias],
    )

    expect(contexts.get(firstAlias)).toMatchObject({
      parentMentionId: "negative-alias-row",
      parentSentiment: "negative",
      subjectIds: ["subject-negative", "subject-neutral"],
      inheritAllCommentSubjectIds: ["subject-negative"],
    })
    expect(contexts.get(laterAlias)).toEqual(contexts.get(firstAlias))
  })

  it("resolves a TikTok parent by post external id when the configured URL lacks a handle", async () => {
    const storedUrl = "https://www.tiktok.com/@creator/video/7665752426237988103"
    mentionFixtures.push({
      organizationId: "org-1",
      platform: "tiktok",
      contentKind: "VIDEO",
      id: "tiktok-negative-parent",
      externalId: "apify:7665752426237988103",
      postExternalId: "7665752426237988103",
      url: storedUrl,
      canonicalUrl: storedUrl,
      matchedTerm: "Araz",
      sentiment: "negative",
      subjectMatches: [{ subjectId: "subject-araz", status: "MATCHED" }],
    })

    const contexts = await parentMatchContextsForComments(
      "org-1",
      "tiktok",
      ["https://www.tiktok.com/video/7665752426237988103"],
      ["7665752426237988103"],
    )

    expect(contexts.get("7665752426237988103")).toMatchObject({
      parentMentionId: "tiktok-negative-parent",
      inheritAllCommentSubjectIds: ["subject-araz"],
    })
    expect(db.socialMention.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { postExternalId: { in: ["7665752426237988103"] } },
        ]),
      }),
    }))
  })

  it("does not resolve deleted or purged parents as comment context", async () => {
    const deletedUrl = "https://tiktok.com/@brand/video/deleted"
    const purgedUrl = "https://tiktok.com/@brand/video/purged"
    mentionFixtures.push(
      {
        organizationId: "org-1", platform: "tiktok", contentKind: "VIDEO", id: "deleted-parent",
        url: deletedUrl, canonicalUrl: deletedUrl, matchedTerm: "Brand", sentiment: "negative",
        deletedAtSource: new Date("2026-07-31T00:00:00Z"), subjectMatches: [{ subjectId: "subject-1" }],
      },
      {
        organizationId: "org-1", platform: "tiktok", contentKind: "VIDEO", id: "purged-parent",
        url: purgedUrl, canonicalUrl: purgedUrl, matchedTerm: "Brand", sentiment: "negative",
        purgedAt: new Date("2026-07-31T00:00:00Z"), subjectMatches: [{ subjectId: "subject-1" }],
      },
    )

    await expect(parentMatchContextsForComments("org-1", "tiktok", [deletedUrl, purgedUrl]))
      .resolves.toEqual(new Map())
  })

  // Прод, 2026-08-03: видео «Araz Market платит зарплату сыну шехида» получило
  // negative по словам горя, и правило «негативный родитель → все комментарии»
  // приняло 275 соболезнований от 246 авторов. Тон траура больше не даёт посту
  // права раздавать релевантность.
  it("does not let a condolence post license every comment under it", async () => {
    mentionFixtures.push({
      organizationId: "org-1",
      platform: "tiktok",
      contentKind: "VIDEO",
      id: "parent-condolence",
      url: "https://tiktok.com/@xeber.group1/video/7668437904028355860",
      canonicalUrl: "https://tiktok.com/@xeber.group1/video/7668437904028355860",
      matchedTerm: "arazsupermarket",
      sentiment: "negative",
      text: "Allah bütün şəhidlərimizə rəhmət eləsin #şəhid #arazmarket #arazsupermarket",
      subjectMatches: [{ subjectId: "subject-araz", status: "MATCHED" }],
    })

    const contexts = await parentMatchContextsForComments("org-1", "tiktok", ["https://tiktok.com/@xeber.group1/video/7668437904028355860"])

    expect(contexts.get("https://tiktok.com/@xeber.group1/video/7668437904028355860")).toMatchObject({
      parentMentionId: "parent-condolence",
      // Сам пост остаётся находкой и остаётся негативным — мы сняли только
      // право наследования, а не его собственную релевантность.
      parentSentiment: "negative",
      subjectIds: ["subject-araz"],
      inheritAllCommentSubjectIds: [],
    })
  })

  it("keeps inheritance for a genuine complaint post", async () => {
    mentionFixtures.push({
      organizationId: "org-1",
      platform: "facebook",
      contentKind: "POST",
      id: "parent-complaint",
      url: "https://facebook.com/posts/bread",
      canonicalUrl: "https://facebook.com/posts/bread",
      matchedTerm: "araz market",
      sentiment: "negative",
      text: "Araz marketdə təzə çörək tapa bilən var ümumiyyətlə? 5 gün qalmış çörək satılır",
      subjectMatches: [{ subjectId: "subject-araz", status: "MATCHED" }],
    })

    const contexts = await parentMatchContextsForComments("org-1", "facebook", ["https://facebook.com/posts/bread"])

    expect(contexts.get("https://facebook.com/posts/bread")).toMatchObject({
      inheritAllCommentSubjectIds: ["subject-araz"],
    })
  })

  it("applies the condolence gate on the evidence fallback path too", async () => {
    evidenceFixtures.push({
      organizationId: "org-1",
      permalink: "https://instagram.com/p/DcondolenceX",
      mention: {
        platform: "instagram",
        contentKind: "POST",
        id: "parent-condolence-evidence",
        matchedTerm: "araz",
        sentiment: "negative",
        text: "Məkanı cənnət olsun, Allah rəhmət eləsin",
        subjectMatches: [{ subjectId: "subject-araz", status: "MATCHED" }],
      },
    })

    const contexts = await parentMatchContextsForComments("org-1", "instagram", ["https://instagram.com/p/DcondolenceX"])

    expect(contexts.get("https://instagram.com/p/DcondolenceX")).toMatchObject({
      parentMentionId: "parent-condolence-evidence",
      inheritAllCommentSubjectIds: [],
    })
  })
})
