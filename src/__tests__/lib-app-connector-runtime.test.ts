/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { dispatchMarketplaceConnectorEvent } from "@/lib/apps/connector-runtime"

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}))

vi.mock("@/lib/credentials/vault", () => ({
  decryptSecret: vi.fn(() => "xoxb-token"),
}))

const slackManifest = {
  schemaVersion: 1,
  capabilities: {
    webhookSubscriptions: [{
      ref: "slack_post_message",
      eventNames: ["deal_won"],
      targetUrl: "https://slack.com/api/chat.postMessage",
      credentialRef: "slack_bot",
    }],
    settingsKeys: [{
      key: "channel",
      label: "Slack channel",
      type: "string",
      required: false,
      defaultValue: "#sales-wins",
    }],
  },
  requirements: {
    namedCredentialNames: ["slack_bot"],
  },
}

const staticWebhookManifest = {
  schemaVersion: 1,
  capabilities: {
    webhookSubscriptions: [{
      ref: "first_party_audit",
      eventNames: ["audit_event"],
      targetUrl: "https://integrations.leaddrivecrm.org/audit/events",
    }],
  },
}

function makeDb(config: Record<string, unknown>) {
  return makeConnectorDb({
    slug: "slack-deal-notifier",
    manifest: slackManifest,
    config,
    credential: {
      id: "cred-slack",
      organizationId: "org1",
      name: "slack_bot",
      baseUrl: "https://slack.com/api",
      authType: "bearer",
      authConfig: {},
      secretCiphertext: "cipher",
      secretIv: "iviviviviviviviv",
      secretTag: "tagtagtagtagtagt",
      secretAlg: "aes-256-gcm-v1",
    },
  })
}

function makeConnectorDb(input: {
  slug: string
  manifest: Record<string, unknown>
  config: Record<string, unknown>
  credential?: Record<string, unknown> | null
}) {
  return {
    appInstallation: {
      findMany: vi.fn().mockResolvedValue([{
        id: `install-${input.slug}`,
        config: input.config,
        app: {
          slug: input.slug,
          manifest: input.manifest,
        },
      }]),
    },
    namedCredential: {
      findFirst: vi.fn().mockResolvedValue(input.credential ?? null),
    },
  } as any
}

describe("dispatchMarketplaceConnectorEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("delivers Slack deal notifier when dotted CRM event matches underscored manifest event", async () => {
    const db = makeDb({
      channel: "#wins",
      __marketplaceProvisioning: { setupComplete: true },
    })
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }))

    await dispatchMarketplaceConnectorEvent("org1", "deal.won", {
      id: "deal1",
      name: "Enterprise renewal",
      valueAmount: 25000,
      stage: "WON",
    }, { db, fetcher })

    expect(fetcher).toHaveBeenCalledWith("https://slack.com/api/chat.postMessage", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        authorization: "Bearer xoxb-token",
        "content-type": "application/json",
      }),
    }))
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body).toMatchObject({
      channel: "#wins",
      text: "Won deal: Enterprise renewal",
    })
  })

  it("does not deliver connector webhooks while setup is incomplete", async () => {
    const db = makeDb({
      channel: "#wins",
      __marketplaceProvisioning: { setupComplete: false },
    })
    const fetcher = vi.fn()

    await dispatchMarketplaceConnectorEvent("org1", "deal.won", {
      id: "deal1",
      name: "Enterprise renewal",
    }, { db, fetcher })

    expect(db.namedCredential.findFirst).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("delivers static first-party webhook subscriptions only through the allowlisted host", async () => {
    const db = makeConnectorDb({
      slug: "audit-log-exporter",
      manifest: staticWebhookManifest,
      config: {
        __marketplaceProvisioning: { setupComplete: true },
      },
      credential: null,
    })
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }))

    await dispatchMarketplaceConnectorEvent("org1", "audit_event", {
      id: "audit1",
    }, { db, fetcher })

    expect(db.namedCredential.findFirst).not.toHaveBeenCalled()
    expect(fetcher).toHaveBeenCalledWith("https://integrations.leaddrivecrm.org/audit/events", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }))
    const body = JSON.parse(fetcher.mock.calls[0][1].body)
    expect(body).toMatchObject({
      event: "audit_event",
      organizationId: "org1",
      data: { id: "audit1" },
    })
  })
})
