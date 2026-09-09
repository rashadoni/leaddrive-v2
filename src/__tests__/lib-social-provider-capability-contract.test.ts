import { describe, expect, it } from "vitest"
import {
  assertValidProviderBatch,
  canonicalProviderUrl,
  PROVIDER_CONTRACT_VERSION,
  providerCandidateBoundaryDraft,
  providerRecordToIngestInput,
  validateProviderBatch,
  type ProviderCandidateRecord,
  type ProviderCommentRecord,
  type ProviderContentRecord,
} from "@/lib/social/provider-capability-contract"

const provenance = {
  providerKey: "bright-data",
  adapterKey: "BRIGHT_DATA",
  providerItemId: "item-1",
  observedAt: "2026-07-13T12:00:00.000Z",
  schemaVersion: "vendor-2026-07",
}

describe("provider capability contract", () => {
  it("normalizes tracking variants to one canonical URL", () => {
    expect(canonicalProviderUrl("https://WWW.Instagram.com/p/ABC/?utm_source=x&igshid=1#comments"))
      .toBe("https://instagram.com/p/ABC")
  })

  it("keeps discovery candidates outside the final mention boundary", () => {
    const candidate: ProviderCandidateRecord = {
      recordType: "CANDIDATE",
      platform: "instagram",
      url: "https://instagram.com/p/ABC?utm_source=search",
      query: "Acme Robotics",
      provenance,
    }
    const draft = providerCandidateBoundaryDraft(candidate)

    expect(draft).toMatchObject({
      providerKey: "bright-data",
      canonicalUrl: "https://instagram.com/p/ABC",
      text: null,
      contentKind: "UNKNOWN",
      relevanceStatus: "PENDING",
      policySnapshot: { candidateOnly: true },
    })
    expect(() => providerRecordToIngestInput({
      organizationId: "org-1",
      sourceId: "source-1",
      acquisitionMode: "LICENSED_PROVIDER",
    }, candidate)).toThrow("cannot cross the mention ingest boundary")
  })

  it("maps enriched content into the existing observation boundary with provenance", () => {
    const content: ProviderContentRecord = {
      recordType: "CONTENT",
      platform: "instagram",
      externalId: "post-1",
      contentKind: "POST",
      url: "https://instagram.com/p/ABC",
      text: "Acme Robotics launched a new product",
      publishedAt: "2026-07-13T10:00:00.000Z",
      author: { name: "News", handle: "news" },
      provenance,
    }

    const input = providerRecordToIngestInput({
      organizationId: "org-1",
      sourceId: "source-1",
      routePlanId: "route-1",
      providerRunId: "run-1",
      acquisitionMode: "LICENSED_PROVIDER",
    }, content)

    expect(input).toMatchObject({
      organizationId: "org-1",
      platform: "instagram",
      externalId: "post-1",
      text: content.text,
      authorHandle: "news",
      sourceProvider: "provider_api",
      observation: {
        routePlanId: "route-1",
        providerRunId: "run-1",
        adapterKey: "BRIGHT_DATA",
        providerKey: "bright-data",
        providerItemId: "item-1",
        acquisitionMode: "LICENSED_PROVIDER",
        policySnapshot: { candidateBoundaryPassed: true },
      },
    })
  })

  it("preserves native provenance for official and connected-account routes", () => {
    const content: ProviderContentRecord = {
      recordType: "CONTENT",
      platform: "youtube",
      externalId: "video-1",
      contentKind: "VIDEO",
      url: "https://youtube.com/watch?v=video-1",
      text: "Acme Robotics launch",
      provenance: { ...provenance, providerKey: "youtube", adapterKey: "YOUTUBE_DATA_API" },
    }

    expect(providerRecordToIngestInput({
      organizationId: "org-1",
      sourceId: "source-1",
      acquisitionMode: "OFFICIAL_API",
    }, content).sourceProvider).toBe("native")
  })

  it("preserves comment/reply identity and parent linkage", () => {
    const comment: ProviderCommentRecord = {
      recordType: "COMMENT",
      platform: "tiktok",
      externalId: "reply-1",
      contentKind: "REPLY",
      text: "Where can I buy it?",
      postExternalId: "video-1",
      parentExternalId: "comment-1",
      threadExternalId: "video-1",
      replyToExternalId: "comment-1",
      parentPostUrl: "https://tiktok.com/@brand/video/1",
      depth: 1,
      author: { handle: "buyer", profileUrl: "https://tiktok.com/@buyer" },
      provenance,
    }

    const input = providerRecordToIngestInput({
      organizationId: "org-1",
      sourceId: "source-1",
      acquisitionMode: "LICENSED_PROVIDER",
    }, comment)

    expect(input).toMatchObject({
      sourceType: "reply",
      contentKind: "REPLY",
      postExternalId: "video-1",
      parentExternalId: "comment-1",
      replyToExternalId: "comment-1",
      depth: 1,
      parentPostUrl: "https://tiktok.com/@brand/video/1",
      sourceMetadata: { authorProfileUrl: "https://tiktok.com/@buyer" },
    })
  })

  it("rejects a provided author profile URL outside http(s)", () => {
    const content: ProviderContentRecord = {
      recordType: "CONTENT",
      platform: "instagram",
      externalId: "post-invalid-author-url",
      contentKind: "POST",
      url: "https://instagram.com/p/INVALID-AUTHOR",
      text: "Synthetic post",
      author: { handle: "unsafe", profileUrl: "file:///etc/passwd" },
      provenance,
    }

    expect(validateProviderBatch({
      contractVersion: PROVIDER_CONTRACT_VERSION,
      providerKey: "bright-data",
      capability: "ENRICH_CONTENT",
      records: [content],
    }).errors).toContain("records[0].author.profileUrl must be an http(s) URL")
  })

  it("rejects replies without a parent identity or reply depth", () => {
    const reply: ProviderCommentRecord = {
      recordType: "COMMENT",
      platform: "facebook",
      externalId: "reply-without-parent",
      contentKind: "REPLY",
      text: "Synthetic malformed reply",
      postExternalId: "post-1",
      parentExternalId: null,
      threadExternalId: "post-1",
      parentPostUrl: "https://facebook.com/example/posts/1",
      depth: 0,
      provenance,
    }

    expect(validateProviderBatch({
      contractVersion: PROVIDER_CONTRACT_VERSION,
      providerKey: "bright-data",
      capability: "READ_COMMENTS",
      records: [reply],
    }).errors).toEqual(expect.arrayContaining([
      "records[0].parentExternalId is required for replies",
      "records[0].depth must be at least 1 for replies",
    ]))
  })

  it("detects provider schema drift before import", () => {
    const validation = validateProviderBatch({
      contractVersion: PROVIDER_CONTRACT_VERSION,
      providerKey: "bright-data",
      capability: "ENRICH_CONTENT",
      records: [{
        recordType: "CANDIDATE",
        platform: "instagram",
        url: "not-a-url",
        provenance,
      }],
    })

    expect(validation.valid).toBe(false)
    expect(validation.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("invalid for ENRICH_CONTENT"),
      expect.stringContaining("must be an http(s) URL"),
    ]))
    expect(() => assertValidProviderBatch({
      contractVersion: "old-contract",
      providerKey: "bright-data",
      capability: "DISCOVER_URLS",
      records: [],
    })).toThrow(`contractVersion must be ${PROVIDER_CONTRACT_VERSION}`)

    expect(() => providerRecordToIngestInput({
      organizationId: "org-1",
      sourceId: "source-1",
      acquisitionMode: "LICENSED_PROVIDER",
    }, {
      recordType: "CONTENT",
      platform: "instagram",
      externalId: "post-without-text",
      contentKind: "POST",
      url: "https://instagram.com/p/EMPTY",
      text: "",
      provenance,
    })).toThrow("text is required before enrichment")
  })

  it("accepts USD or verifiable units and rejects incomplete cost evidence", () => {
    const base = {
      contractVersion: PROVIDER_CONTRACT_VERSION,
      providerKey: "bright-data",
      capability: "DISCOVER_URLS" as const,
      records: [],
    }

    expect(validateProviderBatch({ ...base, cost: { amountUsd: 0.01 } }).valid).toBe(true)
    expect(validateProviderBatch({ ...base, cost: { units: 10, unitName: "records" } }).valid).toBe(true)
    expect(validateProviderBatch({ ...base, cost: {} }).errors)
      .toContain("cost requires amountUsd or units")
    expect(validateProviderBatch({ ...base, cost: { units: 10 } }).errors)
      .toContain("cost.unitName is required when units are provided")
  })
})
