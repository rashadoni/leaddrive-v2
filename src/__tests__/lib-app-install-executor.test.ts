/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppInstallError, installTenantApp } from "@/lib/apps/install-executor"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}))

const leadScoringManifest = {
  schemaVersion: 1,
  capabilities: {
    customFields: [
      {
        entityType: "lead",
        fieldName: "ai_score",
        fieldLabel: "AI Score",
        fieldType: "number",
        required: false,
      },
    ],
    eventSubscriptions: [
      {
        ref: "lead_score_recompute",
        eventName: "lead_updated",
        codeModuleSlug: "lead_scoring",
      },
    ],
  },
}

function makeDb(overrides: Record<string, unknown> = {}) {
  const db = {
    app: {
      findFirst: vi.fn().mockResolvedValue({
        id: "app-lead",
        slug: "lead-scoring-rules",
        version: "1.0.0",
        manifest: leadScoringManifest,
      }),
    },
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    namedCredential: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    appInstallation: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async (args: any) => ({
        id: "install-1",
        appId: args.data.appId,
        installedVersion: args.data.installedVersion,
        config: args.data.config,
        status: args.data.status,
        installedAt: new Date("2026-06-27T00:00:00.000Z"),
        updatedAt: new Date("2026-06-27T00:00:00.000Z"),
      })),
      update: vi.fn(),
    },
    customField: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "cf-1" }),
      update: vi.fn(),
    },
    platformEventDefinition: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "event-1" }),
      update: vi.fn(),
    },
    ...overrides,
  }
  return db as any
}

describe("installTenantApp", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates custom fields, event definitions, and an active installation", async () => {
    const db = makeDb()

    const result = await installTenantApp({
      db,
      appSlug: "lead-scoring-rules",
      organizationId: "org-1",
      installedBy: "admin-1",
      orgContext: { plan: "enterprise", addons: [], modules: { sales: true } },
    })

    expect(db.customField.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        entityType: "lead",
        fieldName: "ai_score",
        fieldType: "number",
        isActive: true,
      }),
    }))
    expect(db.platformEventDefinition.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        name: "lead_updated",
        isActive: true,
        createdBy: "admin-1",
      }),
    }))
    expect(db.appInstallation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        appId: "app-lead",
        installedVersion: "1.0.0",
        status: "active",
      }),
    }))
    expect(result.executed).toBe(true)
    expect(result.provisionedResources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "custom_field", status: "created", id: "cf-1" }),
      expect.objectContaining({ kind: "platform_event_definition", status: "created", id: "event-1" }),
    ]))
    expect(result.installation.config).toMatchObject({
      __marketplaceProvisioning: expect.objectContaining({
        appSlug: "lead-scoring-rules",
        setupComplete: true,
      }),
    })
  })

  it("reuses existing custom fields without changing their type or validation", async () => {
    const db = makeDb({
      customField: {
        findUnique: vi.fn().mockResolvedValue({
          id: "cf-existing",
          fieldType: "string",
          isRequired: true,
          options: [],
        }),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: "cf-existing" }),
      },
    })

    const result = await installTenantApp({
      db,
      appSlug: "lead-scoring-rules",
      organizationId: "org-1",
      installedBy: "admin-1",
      orgContext: { plan: "enterprise", addons: [], modules: { sales: true } },
    })

    expect(db.customField.create).not.toHaveBeenCalled()
    expect(db.customField.update).toHaveBeenCalledWith({
      where: { id: "cf-existing" },
      data: { isActive: true },
      select: { id: true },
    })
    expect(result.provisionedResources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "custom_field", status: "reused", id: "cf-existing" }),
    ]))
    expect(result.warnings.join("\n")).toContain("kept existing type")
    expect(result.warnings.join("\n")).toContain("kept existing validation setting")
  })

  it("installs as setup_required metadata when a required named credential is missing", async () => {
    const db = makeDb({
      app: {
        findFirst: vi.fn().mockResolvedValue({
          id: "app-slack",
          slug: "slack-deal-notifier",
          version: "1.0.0",
          manifest: {
            schemaVersion: 1,
            capabilities: {
              settingsKeys: [{
                key: "channel",
                label: "Channel",
                type: "string",
                required: false,
                defaultValue: "#sales-wins",
              }],
              webhookSubscriptions: [{
                ref: "slack_post_message",
                eventNames: ["deal_won"],
                targetUrl: "https://slack.com/api/chat.postMessage",
                credentialRef: "slack_bot",
              }],
            },
            requirements: { namedCredentialNames: ["slack_bot"] },
          },
        }),
      },
      namedCredential: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    })

    const result = await installTenantApp({
      db,
      appSlug: "slack-deal-notifier",
      organizationId: "org-1",
      installedBy: "admin-1",
      orgContext: { plan: "enterprise", addons: [], modules: { sales: true } },
    })

    expect(db.appInstallation.create).toHaveBeenCalled()
    expect(db.customField.create).not.toHaveBeenCalled()
    expect(result.installation.config).toMatchObject({
      channel: "#sales-wins",
      __marketplaceProvisioning: {
        setupComplete: false,
        missingNamedCredentials: ["slack_bot"],
      },
    })
    expect(result.warnings.join("\n")).toContain("slack_bot")
  })

  it("rejects install when an active installation already exists", async () => {
    const db = makeDb({
      appInstallation: {
        findUnique: vi.fn().mockResolvedValue({
          id: "install-existing",
          appId: "app-lead",
          installedVersion: "1.0.0",
          config: {},
          status: "active",
          installedAt: new Date("2026-06-27T00:00:00.000Z"),
          updatedAt: new Date("2026-06-27T00:00:00.000Z"),
          uninstalledAt: null,
        }),
        create: vi.fn(),
        update: vi.fn(),
      },
    })

    await expect(installTenantApp({
      db,
      appSlug: "lead-scoring-rules",
      organizationId: "org-1",
      installedBy: "admin-1",
      orgContext: { plan: "enterprise", addons: [], modules: { sales: true } },
    })).rejects.toMatchObject({
      name: "AppInstallError",
      code: "already_installed",
      status: 409,
    } satisfies Partial<AppInstallError>)

    expect(db.appInstallation.create).not.toHaveBeenCalled()
    expect(db.appInstallation.update).not.toHaveBeenCalled()
  })

  it("reactivates a soft-uninstalled installation instead of creating a duplicate", async () => {
    const db = makeDb({
      appInstallation: {
        findUnique: vi.fn().mockResolvedValue({
          id: "install-existing",
          appId: "app-lead",
          installedVersion: "0.9.0",
          config: {},
          status: "disabled",
          installedAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          uninstalledAt: new Date("2026-02-01T00:00:00.000Z"),
        }),
        create: vi.fn(),
        update: vi.fn().mockImplementation(async (args: any) => ({
          id: "install-existing",
          appId: "app-lead",
          installedVersion: args.data.installedVersion,
          config: args.data.config,
          status: args.data.status,
          installedAt: args.data.installedAt,
          updatedAt: new Date("2026-06-27T00:00:00.000Z"),
        })),
      },
    })

    const result = await installTenantApp({
      db,
      appSlug: "lead-scoring-rules",
      organizationId: "org-1",
      installedBy: "admin-1",
      orgContext: { plan: "enterprise", addons: [], modules: { sales: true } },
    })

    expect(db.appInstallation.create).not.toHaveBeenCalled()
    expect(db.appInstallation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "install-existing" },
      data: expect.objectContaining({
        installedVersion: "1.0.0",
        status: "active",
        uninstalledAt: null,
        installedBy: "admin-1",
      }),
    }))
    expect(result.installation.id).toBe("install-existing")
  })
})
