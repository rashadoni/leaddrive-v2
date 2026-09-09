import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildMonitoringReadinessEnvironment,
  summarizeMonitoringReadiness,
  type MonitoringReadinessSource,
} from "@/lib/social/monitoring-source"

const activeEnv = {
  searchIndexEnabled: true,
  searchIndexEndpointConfigured: true,
  searchIndexAllowlistConfigured: true,
  providerAllowlistConfigured: true,
  providerReplyAllowlistConfigured: true,
  notificationInboxAllowlistConfigured: true,
  browserCaptureEnabled: true,
  youtubeApiKeyConfigured: false,
  liveRepliesEnabled: true,
}

function source(overrides: Partial<MonitoringReadinessSource> = {}): MonitoringReadinessSource {
  return {
    platform: "instagram",
    sourceType: "page",
    ownership: "external",
    collectionMode: "search_index",
    status: "needs_setup",
    cadenceMinutes: 360,
    settings: {},
    lastError: null,
    ...overrides,
  }
}

describe("social monitoring source readiness", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it("keeps external search-index sources blocked until approved runtime configuration exists", () => {
    const readiness = summarizeMonitoringReadiness(source())

    expect(readiness).toMatchObject({
      overall: "needs_setup",
      canCollect: false,
      canReplyLive: false,
      externalSendsDisabled: true,
      steps: expect.arrayContaining([
        expect.objectContaining({ key: "collection", state: "needs_setup", action: "enable_search_index" }),
        expect.objectContaining({ key: "reply", state: "manual_only", action: "use_ai_draft_or_original" }),
        expect.objectContaining({ key: "liveSend", state: "dry_run", action: "finish_reply_setup_first" }),
      ]),
    })
  })

  it("marks external search-index collection ready while keeping replies manual-only", () => {
    const readiness = summarizeMonitoringReadiness(source(), { env: activeEnv })

    expect(readiness).toMatchObject({
      overall: "dry_run",
      canCollect: true,
      canReplyLive: false,
      externalSendsDisabled: true,
      steps: expect.arrayContaining([
        expect.objectContaining({ key: "collection", state: "ready", action: "run_source_now" }),
        expect.objectContaining({ key: "reply", state: "manual_only", action: "use_ai_draft_or_original" }),
      ]),
    })
  })

  it("marks external search-index collection ready from UI-saved settings without env", () => {
    const readiness = summarizeMonitoringReadiness(source({
      settings: {
        searchIndex: {
          approved: true,
          endpoint: "https://search.example.com/social",
          allowedHosts: ["search.example.com"],
        },
      },
    }))

    expect(readiness).toMatchObject({
      overall: "dry_run",
      canCollect: true,
      canReplyLive: false,
      externalSendsDisabled: true,
      steps: expect.arrayContaining([
        expect.objectContaining({ key: "collection", state: "ready", action: "run_source_now" }),
      ]),
    })
  })

  it("marks Apify search-index collection ready from UI-saved token without endpoint or allowlist", () => {
    const readiness = summarizeMonitoringReadiness(source({
      settings: {
        searchIndex: {
          approved: true,
          provider: "apify",
          encryptedToken: "ciphertext",
        },
      },
    }))

    expect(readiness).toMatchObject({
      overall: "dry_run",
      canCollect: true,
      canReplyLive: false,
      externalSendsDisabled: true,
      steps: expect.arrayContaining([
        expect.objectContaining({ key: "collection", state: "ready", action: "run_source_now" }),
      ]),
    })
  })

  it("ignores a legacy tokenEnv even when it names the populated Auth.js secret", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "session-secret-must-not-become-a-provider-token")
    const readiness = summarizeMonitoringReadiness(source({
      settings: {
        searchIndex: {
          approved: true,
          provider: "apify",
          tokenEnv: "NEXTAUTH_SECRET",
        },
      },
    }))

    expect(readiness).toMatchObject({
      overall: "needs_setup",
      canCollect: false,
      canReplyLive: false,
      externalSendsDisabled: true,
      steps: expect.arrayContaining([
        expect.objectContaining({
          key: "collection",
          state: "needs_setup",
          reason: "search_index_token_missing",
          action: "configure_search_index_token",
        }),
      ]),
    })
  })

  it("marks owned official Instagram sources ready only when a connected account exists", () => {
    const readiness = summarizeMonitoringReadiness(
      source({
        ownership: "owned",
        collectionMode: "official_api",
        status: "active",
        settings: { socialAccountId: "account-1" },
      }),
      {
        env: { ...activeEnv, liveRepliesEnabled: false },
        accounts: [{ id: "account-1", platform: "instagram", isActive: true, accessToken: "encrypted-token" }],
      },
    )

    expect(readiness).toMatchObject({
      overall: "dry_run",
      canCollect: true,
      canReplyLive: false,
      externalSendsDisabled: true,
      steps: expect.arrayContaining([
        expect.objectContaining({ key: "collection", state: "ready", action: "run_source_now" }),
        expect.objectContaining({ key: "reply", state: "ready", action: "reply_after_policy" }),
        expect.objectContaining({ key: "liveSend", state: "dry_run", action: "enable_live_reply_gate" }),
      ]),
    })
  })

  it("marks external official YouTube collection ready with an API key and no OAuth account", () => {
    vi.stubEnv("YOUTUBE_API_KEY", "youtube-api-key")

    const readiness = summarizeMonitoringReadiness(source({
      platform: "youtube",
      sourceType: "keyword",
      ownership: "external",
      collectionMode: "official_api",
      status: "limited",
      cadenceMinutes: 1440,
    }))

    expect(buildMonitoringReadinessEnvironment().youtubeApiKeyConfigured).toBe(true)
    expect(readiness).toMatchObject({
      canCollect: true,
      canReplyLive: false,
      externalSendsDisabled: true,
      steps: expect.arrayContaining([
        expect.objectContaining({
          key: "collection",
          state: "ready",
          reason: "youtube_api_key_ready",
          action: "run_source_now",
        }),
      ]),
    })
  })

  it("allows provider live replies only when read, reply, allowlist, token, and live gates are ready", () => {
    const readiness = summarizeMonitoringReadiness(
      source({
        collectionMode: "provider_api",
        status: "active",
        settings: {
          provider: {
            approved: true,
            endpoint: "https://listener.example.com/social/search",
            encryptedToken: "provider-ciphertext",
            reply: {
              approved: true,
              endpoint: "https://reply.example.com/social/reply",
              encryptedToken: "reply-ciphertext",
            },
          },
        },
      }),
      { env: activeEnv },
    )

    expect(readiness).toMatchObject({
      overall: "ready",
      canCollect: true,
      canReplyLive: true,
      externalSendsDisabled: false,
      steps: expect.arrayContaining([
        expect.objectContaining({ key: "collection", state: "ready" }),
        expect.objectContaining({ key: "reply", state: "ready" }),
        expect.objectContaining({ key: "liveSend", state: "ready" }),
      ]),
    })
  })

  it("uses server env defaults but keeps live replies off unless the caller confirms the tenant gate", () => {
    vi.stubEnv("SOCIAL_SEARCH_INDEX_ENABLED", "1")
    vi.stubEnv("SOCIAL_SEARCH_INDEX_ENDPOINT", "https://search.example.com/social")
    vi.stubEnv("SOCIAL_SEARCH_INDEX_ALLOWED_HOSTS", "search.example.com")
    vi.stubEnv("SOCIAL_LIVE_REPLY_ENABLED", "1")

    const env = buildMonitoringReadinessEnvironment({ liveRepliesEnabled: false })
    const readiness = summarizeMonitoringReadiness(source(), { env })

    expect(readiness.canCollect).toBe(true)
    expect(readiness.canReplyLive).toBe(false)
    expect(readiness.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "liveSend", state: "dry_run" }),
    ]))
  })
})
