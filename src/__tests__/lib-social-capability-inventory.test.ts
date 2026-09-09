import { describe, expect, it } from "vitest"
import {
  PLATFORM_CAPABILITY_MATRIX,
  computeCapabilityInventory,
  summarizeCapabilityInventory,
  renderCoverageContractMarkdown,
  type CapabilityInventoryContext,
  type CapabilityProofView,
} from "@/lib/social/capability-inventory"

const NOW = new Date("2026-07-12T00:00:00.000Z")

function baseContext(overrides: Partial<CapabilityInventoryContext> = {}): CapabilityInventoryContext {
  return {
    now: NOW,
    proofs: [],
    routePlans: [],
    connectedPlatforms: [],
    apifyExternalEnabled: false,
    genericSearchEnabled: false,
    providerCollectionConfigured: false,
    providerReplyConfigured: false,
    vkServiceTokenPresent: false,
    youtubeApiKeyPresent: false,
    telegramBotTokenPresent: false,
    xApiConfigured: false,
    liveSendEnabled: false,
    ...overrides,
  }
}

function rowFor(rows: ReturnType<typeof computeCapabilityInventory>, platform: string, capability: string, ownership?: string) {
  const match = rows.find(
    (r) => r.platform === platform && r.capability === capability && (ownership ? r.ownership === ownership : true),
  )
  if (!match) throw new Error(`row not found: ${platform}/${capability}/${ownership ?? "*"}`)
  return match
}

function proof(overrides: Partial<CapabilityProofView>): CapabilityProofView {
  return {
    id: "proof-1",
    platform: "instagram",
    capability: "READ_OWNED_COMMENTS",
    contentScopes: ["OWNED"],
    status: "VERIFIED",
    readAllowed: true,
    replyAllowed: false,
    exportAllowed: true,
    aiProcessingAllowed: true,
    contractVersion: "c-1",
    providerKey: "meta_graph",
    adapterKey: "META_GRAPH",
    verifiedAt: new Date("2026-07-01T00:00:00.000Z"),
    sandboxVerifiedAt: new Date("2026-06-20T00:00:00.000Z"),
    expiresAt: null,
    ...overrides,
  }
}

describe("capability inventory — matrix integrity", () => {
  it("has exactly one row per (platform, capability, ownership)", () => {
    const keys = PLATFORM_CAPABILITY_MATRIX.map((d) => `${d.platform}:${d.capability}:${d.ownership}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("declares every declared platform with at least one capability row", () => {
    const rows = computeCapabilityInventory(baseContext())
    for (const platform of ["facebook", "instagram", "tiktok", "youtube", "telegram", "vkontakte", "twitter"]) {
      expect(rows.some((r) => r.platform === platform)).toBe(true)
    }
  })
})

describe("capability inventory — baseline (no config, no proof)", () => {
  const rows = computeCapabilityInventory(baseContext())

  it("owned official capabilities are IMPLEMENTED, not ready", () => {
    expect(rowFor(rows, "instagram", "READ_OWNED_COMMENTS", "OWNED").status).toBe("IMPLEMENTED")
    expect(rowFor(rows, "youtube", "READ_EXTERNAL_COMMENTS", "EXTERNAL").status).toBe("IMPLEMENTED")
    expect(rowFor(rows, "telegram", "READ_THREAD", "OWNED").status).toBe("IMPLEMENTED")
  })

  it("external provider-only comment reads are BLOCKED until configured", () => {
    expect(rowFor(rows, "instagram", "READ_EXTERNAL_COMMENTS", "EXTERNAL").status).toBe("BLOCKED")
    expect(rowFor(rows, "facebook", "READ_EXTERNAL_COMMENTS", "EXTERNAL").status).toBe("BLOCKED")
    expect(rowFor(rows, "tiktok", "READ_EXTERNAL_COMMENTS", "EXTERNAL").status).toBe("BLOCKED")
  })

  it("X requires a paid tier and is BLOCKED at baseline", () => {
    expect(rowFor(rows, "twitter", "DISCOVER_POSTS").status).toBe("BLOCKED")
    expect(rowFor(rows, "twitter", "REPLY_OWNED").status).toBe("BLOCKED")
  })

  it("external replies fall back to manual OPEN_NATIVE and stay BLOCKED", () => {
    const r = rowFor(rows, "instagram", "REPLY_EXTERNAL", "EXTERNAL")
    expect(r.status).toBe("BLOCKED")
    expect(r.engagementMode).toBe("OPEN_NATIVE")
  })

  it("never reports liveSendReady when nothing is verified", () => {
    expect(rows.every((r) => r.liveSendReady === false)).toBe(true)
  })
})

describe("capability inventory — CONFIGURED transitions", () => {
  it("connecting an owned account moves owned read to CONFIGURED", () => {
    const rows = computeCapabilityInventory(baseContext({ connectedPlatforms: ["instagram"] }))
    expect(rowFor(rows, "instagram", "READ_OWNED_COMMENTS", "OWNED").status).toBe("CONFIGURED")
  })

  it("approved Apify external config moves external read to CONFIGURED (best-effort)", () => {
    const rows = computeCapabilityInventory(baseContext({ apifyExternalEnabled: true }))
    expect(rowFor(rows, "facebook", "READ_EXTERNAL_COMMENTS", "EXTERNAL").status).toBe("CONFIGURED")
  })

  it("paid X credentials move X discovery to CONFIGURED", () => {
    const rows = computeCapabilityInventory(baseContext({ xApiConfigured: true }))
    expect(rowFor(rows, "twitter", "DISCOVER_POSTS").status).toBe("CONFIGURED")
  })

  it("youtube api key configures the official public read path", () => {
    const rows = computeCapabilityInventory(baseContext({ youtubeApiKeyPresent: true }))
    expect(rowFor(rows, "youtube", "READ_EXTERNAL_COMMENTS", "EXTERNAL").status).toBe("CONFIGURED")
  })
})

describe("capability inventory — proof-driven statuses", () => {
  it("a VERIFIED read proof yields PRODUCTION_VERIFIED", () => {
    const rows = computeCapabilityInventory(
      baseContext({ connectedPlatforms: ["instagram"], proofs: [proof({})] }),
    )
    const r = rowFor(rows, "instagram", "READ_OWNED_COMMENTS", "OWNED")
    expect(r.status).toBe("PRODUCTION_VERIFIED")
    expect(r.proof?.id).toBe("proof-1")
    expect(r.proof?.verifiedAt).toBe("2026-07-01T00:00:00.000Z")
  })

  it("a sandbox-only proof yields SANDBOX_VERIFIED", () => {
    const rows = computeCapabilityInventory(
      baseContext({ proofs: [proof({ status: "DRAFT", verifiedAt: null })] }),
    )
    expect(rowFor(rows, "instagram", "READ_OWNED_COMMENTS", "OWNED").status).toBe("SANDBOX_VERIFIED")
  })

  it("an expired proof does not upgrade the row", () => {
    const rows = computeCapabilityInventory(
      baseContext({
        connectedPlatforms: ["instagram"],
        proofs: [proof({ expiresAt: new Date("2026-07-10T00:00:00.000Z") })],
      }),
    )
    // expired proof ignored → falls back to CONFIGURED (account connected)
    expect(rowFor(rows, "instagram", "READ_OWNED_COMMENTS", "OWNED").status).toBe("CONFIGURED")
  })

  it("a read-only proof does not satisfy a reply capability", () => {
    const rows = computeCapabilityInventory(
      baseContext({
        proofs: [proof({ capability: "REPLY_EXTERNAL", contentScopes: ["MENTIONED"], replyAllowed: false })],
      }),
    )
    expect(rowFor(rows, "instagram", "REPLY_EXTERNAL", "EXTERNAL").status).toBe("BLOCKED")
  })

  it("a verified provider reply proof enables PROVIDER_REPLY engagement mode", () => {
    const rows = computeCapabilityInventory(
      baseContext({
        proofs: [
          proof({
            capability: "REPLY_EXTERNAL",
            contentScopes: ["MENTIONED"],
            replyAllowed: true,
            providerKey: "sprinklr",
            adapterKey: "LICENSED_PROVIDER",
          }),
        ],
      }),
    )
    const r = rowFor(rows, "instagram", "REPLY_EXTERNAL", "EXTERNAL")
    expect(r.status).toBe("PRODUCTION_VERIFIED")
    expect(r.engagementMode).toBe("PROVIDER_REPLY")
  })

  it("reply reaches liveSendReady only when the global live-send flag is on", () => {
    const replyProof = proof({
      capability: "REPLY_OWNED",
      contentScopes: ["OWNED"],
      replyAllowed: true,
    })
    const off = computeCapabilityInventory(baseContext({ proofs: [replyProof], liveSendEnabled: false }))
    expect(rowFor(off, "instagram", "REPLY_OWNED", "OWNED").liveSendReady).toBe(false)

    const on = computeCapabilityInventory(baseContext({ proofs: [replyProof], liveSendEnabled: true }))
    expect(rowFor(on, "instagram", "REPLY_OWNED", "OWNED").liveSendReady).toBe(true)
  })
})

describe("capability inventory — route corroboration", () => {
  it("counts matching route plans by status", () => {
    const rows = computeCapabilityInventory(
      baseContext({
        connectedPlatforms: ["instagram"],
        routePlans: [
          { platform: "instagram", capability: "READ_OWNED_COMMENTS", contentScope: "OWNED", primaryAdapter: "META_GRAPH", acquisitionMode: "OFFICIAL_API", status: "ACTIVE" },
          { platform: "instagram", capability: "READ_OWNED_COMMENTS", contentScope: "OWNED", primaryAdapter: "META_GRAPH", acquisitionMode: "OFFICIAL_API", status: "DEGRADED" },
        ],
      }),
    )
    const r = rowFor(rows, "instagram", "READ_OWNED_COMMENTS", "OWNED")
    expect(r.routes.activeCount).toBe(1)
    expect(r.routes.degradedCount).toBe(1)
    expect(r.routes.acquisitionModes).toEqual(["OFFICIAL_API"])
  })
})

describe("coverage contract markdown", () => {
  it("summarizes and renders from the same rows the UI uses", () => {
    const rows = computeCapabilityInventory(baseContext({ connectedPlatforms: ["instagram"] }))
    const summary = summarizeCapabilityInventory(rows)
    expect(summary.total).toBe(rows.length)

    const md = renderCoverageContractMarkdown(rows, {
      organizationName: "Acme",
      generatedAt: NOW,
    })
    expect(md).toContain("# Coverage contract")
    expect(md).toContain("Acme")
    expect(md).toContain("## Instagram")
    // Honest disclaimers must be present.
    expect(md).toContain("Live-отправка выключена")
    expect(md).toContain("draft-first")
  })

  it("does not leak secret-shaped fields into the export", () => {
    const rows = computeCapabilityInventory(
      baseContext({ proofs: [proof({})], connectedPlatforms: ["instagram"] }),
    )
    const md = renderCoverageContractMarkdown(rows, { generatedAt: NOW })
    const lower = md.toLowerCase()
    for (const forbidden of ["accesstoken", "encryptedtoken", "apikey", "client_secret", "clientsecret", "bearer "]) {
      expect(lower).not.toContain(forbidden)
    }
  })
})
