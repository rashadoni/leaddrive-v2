import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  wrappers: [] as Array<{ module: string; action: string }>,
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  validateEndpoint: vi.fn(),
}));

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (
    module: string,
    action: string,
    handler: (req: NextRequest, auth: { orgId: string; userId: string; role: string }) => unknown,
  ) => {
    mocks.wrappers.push({ module, action });
    return (req: NextRequest) => handler(req, {
      orgId: "org_voip_only",
      userId: "admin_1",
      role: "admin",
    });
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    channelConfig: {
      findFirst: mocks.findFirst,
      update: mocks.update,
      create: mocks.create,
    },
  },
}));

// The fingerprint stays real: it is the pure comparison that decides whether
// the network probe runs at all, so mocking it would test nothing.
vi.mock("@/lib/voip/endpoint-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/voip/endpoint-guard")>()),
  validateVoipSettingsEndpoint: mocks.validateEndpoint,
}));

import { GET, PUT } from "@/app/api/v1/voip/config/route";

const row = {
  id: "voip_1",
  organizationId: "org_voip_only",
  channelType: "voip",
  configName: "Asterisk VoIP",
  phoneNumber: null,
  apiKey: null,
  botToken: null,
  appSecret: null,
  accessToken: null,
  phoneNumberId: null,
  businessAccountId: null,
  verifyToken: null,
  webhookUrl: null,
  isActive: true,
  settings: {
    provider: "asterisk",
    ariHost: "host",
    ariPort: 8088,
    username: "user",
    password: "password",
    context: "from-internal",
    callerExtension: "100",
    recordCalls: false,
    voiceAgentEnabled: true,
    manualLeadAiCallsEnabled: false,
    voiceQueueEnabled: false,
    voiceAgentMode: "outbound",
    voiceAgentPrompt: "prompt",
    voiceAgentKnowledge: "verified facts",
  },
  createdAt: new Date("2026-08-09T00:00:00Z"),
  updatedAt: new Date("2026-08-09T00:00:00Z"),
};

function request(method = "GET", body?: unknown, authorization = false) {
  return new NextRequest("https://app.leaddrivecrm.org/api/v1/voip/config", {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(authorization ? { authorization: "Bearer ld_test" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function asteriskPayload(overrides: Record<string, unknown> = {}) {
  return {
    configName: "Asterisk VoIP",
    phoneNumber: "",
    isActive: true,
    settings: {
      provider: "asterisk",
      ariHost: "host",
      ariPort: 8088,
      username: "user",
      password: "password",
      context: "from-internal",
      callerExtension: "100",
      recordCalls: false,
      voiceAgentEnabled: true,
      manualLeadAiCallsEnabled: false,
      voiceQueueEnabled: false,
      voiceAgentMode: "outbound",
      voiceAgentPrompt: "prompt",
      voiceAgentKnowledge: "verified facts",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.validateEndpoint.mockReset();
  mocks.transaction.mockImplementation(async (callback) => callback({
    $executeRaw: mocks.executeRaw,
    channelConfig: {
      findFirst: mocks.findFirst,
      update: mocks.update,
      create: mocks.create,
    },
  }));
  mocks.executeRaw.mockResolvedValue(1);
  mocks.validateEndpoint.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("VoIP-only provider configuration", () => {
  it("registers GET and PUT behind the VoIP admin gate", () => {
    expect(mocks.wrappers).toEqual([
      { module: "voip", action: "admin" },
      { module: "voip", action: "admin" },
    ]);
  });

  it("loads one deterministic canonical VoIP config", async () => {
    mocks.findFirst.mockResolvedValue(row);

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { organizationId: "org_voip_only", channelType: "voip" },
      orderBy: [
        { updatedAt: "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
    });
  });

  it("creates the first VoIP config without an Omni-channel dependency", async () => {
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue(row);

    const res = await PUT(request("PUT", asteriskPayload()));

    expect(res.status).toBe(200);
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(String(mocks.executeRaw.mock.calls[0]?.[0])).toContain("pg_advisory_xact_lock");
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org_voip_only",
        channelType: "voip",
        createdBy: "admin_1",
        configName: "Asterisk VoIP",
      }),
    });
  });

  it("rejects an endpoint that fails the outbound network policy before the transaction", async () => {
    mocks.validateEndpoint.mockRejectedValueOnce(new Error("private address"));

    const res = await PUT(request("PUT", asteriskPayload()));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "VoIP endpoint is not allowed by outbound network policy",
    });
    expect(mocks.validateEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "asterisk", ariHost: "host" }),
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("preserves provider-specific stored settings on a same-provider update", async () => {
    mocks.findFirst.mockResolvedValue({
      ...row,
      settings: { ...row.settings, providerRuntimeHint: "keep" },
    });
    mocks.update.mockResolvedValue(row);

    const res = await PUT(request("PUT", asteriskPayload({ id: "voip_1" })));

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "voip_1" },
      data: expect.objectContaining({
        settings: expect.objectContaining({
          providerRuntimeHint: "keep",
          password: "password",
        }),
      }),
    });
  });

  it("rejects direct mutation of the technical registry capability", async () => {
    vi.stubEnv("VOICE_AGENT_ORGANIZATION_ID", "different_org");
    const payload = asteriskPayload();
    (payload.settings as Record<string, unknown>).voiceAttemptRegistryEnabled = true;

    const res = await PUT(request("PUT", payload));

    expect(res.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("also rejects technical capability mutation from the pilot admin API", async () => {
    vi.stubEnv("VOICE_AGENT_ORGANIZATION_ID", "org_voip_only");
    mocks.findFirst.mockResolvedValue(row);
    mocks.update.mockResolvedValue(row);
    const payload = asteriskPayload({ id: "voip_1" });
    (payload.settings as Record<string, unknown>).voiceAttemptRegistryEnabled = true;

    const res = await PUT(request("PUT", payload));

    expect(res.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("clears a stale registry capability when the pilot organization changes", async () => {
    vi.stubEnv("VOICE_AGENT_ORGANIZATION_ID", "different_org");
    mocks.findFirst.mockResolvedValue({
      ...row,
      settings: { ...row.settings, voiceAttemptRegistryEnabled: true },
    });
    mocks.update.mockResolvedValue(row);

    const res = await PUT(request("PUT", asteriskPayload({ id: "voip_1" })));

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        settings: expect.objectContaining({ voiceAttemptRegistryEnabled: false }),
      }),
    }));
  });

  it("preserves the operator-owned capability during an ordinary pilot settings save", async () => {
    vi.stubEnv("VOICE_AGENT_ORGANIZATION_ID", "org_voip_only");
    mocks.findFirst.mockResolvedValue({
      ...row,
      settings: { ...row.settings, voiceAttemptRegistryEnabled: true },
    });
    mocks.update.mockResolvedValue(row);

    const res = await PUT(request("PUT", asteriskPayload({ id: "voip_1" })));

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        settings: expect.objectContaining({ voiceAttemptRegistryEnabled: true }),
      }),
    }));
  });

  it("keeps a stored provider secret when the edit form leaves it blank", async () => {
    mocks.findFirst.mockResolvedValue(row);
    mocks.update.mockResolvedValue(row);
    const payload = asteriskPayload({ id: "voip_1" });
    payload.settings.password = "";

    const res = await PUT(request("PUT", payload));

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        settings: expect.objectContaining({ password: "password" }),
      }),
    }));
  });

  it("clears a legacy top-level credential when switching providers", async () => {
    mocks.findFirst.mockResolvedValue({
      ...row,
      apiKey: "legacy-provider-secret",
      settings: { ...row.settings, provider: "twilio" },
    });
    mocks.update.mockResolvedValue(row);

    const res = await PUT(request("PUT", asteriskPayload({ id: "voip_1" })));

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ apiKey: null }),
    }));
  });

  it("rejects an invalid attempt to enable manual AI calls", async () => {
    const payload = asteriskPayload();
    payload.settings.provider = "asterisk";
    payload.settings.voiceAgentEnabled = false;
    payload.settings.manualLeadAiCallsEnabled = true;

    const res = await PUT(request("PUT", payload));

    expect(res.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects empty conversation rules while the voice agent is enabled", async () => {
    const payload = asteriskPayload();
    payload.settings.voiceAgentPrompt = "   ";

    const res = await PUT(request("PUT", payload));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "AI conversation rules are required while the voice agent is enabled",
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("allows an empty legacy prompt while the voice agent remains disabled", async () => {
    mocks.findFirst.mockResolvedValue(row);
    mocks.update.mockResolvedValue(row);
    const payload = asteriskPayload({ id: "voip_1" });
    payload.settings.voiceAgentEnabled = false;
    payload.settings.voiceAgentPrompt = "   ";

    const res = await PUT(request("PUT", payload));

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        settings: expect.objectContaining({
          voiceAgentEnabled: false,
          voiceAgentPrompt: "",
        }),
      }),
    }));
  });

  it("rejects a sequential queue unless manual outbound Asterisk AI calls are enabled", async () => {
    const payload = asteriskPayload();
    payload.settings.manualLeadAiCallsEnabled = false;
    payload.settings.voiceQueueEnabled = true;

    const res = await PUT(request("PUT", payload));

    expect(res.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("persists the visible product-knowledge field and sequential queue switch", async () => {
    mocks.findFirst.mockResolvedValue(row);
    mocks.update.mockResolvedValue(row);
    const payload = asteriskPayload({ id: "voip_1" });
    payload.settings.manualLeadAiCallsEnabled = true;
    payload.settings.voiceQueueEnabled = true;
    payload.settings.voiceAgentKnowledge = "CRM-managed product facts";

    const res = await PUT(request("PUT", payload));

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        settings: expect.objectContaining({
          voiceQueueEnabled: true,
          voiceAgentKnowledge: "CRM-managed product facts",
        }),
      }),
    }));
  });

  it("saves the AI prompt while the stored endpoint stays outside the network allowlist", async () => {
    // The production failure this fixes: a legacy origin the allowlist rejects
    // made every prompt edit fail with a network-policy error.
    mocks.validateEndpoint.mockRejectedValue(new Error("private address"));
    mocks.findFirst.mockResolvedValue(row);
    mocks.update.mockResolvedValue(row);
    const payload = asteriskPayload({ id: "voip_1" });
    payload.settings.voiceAgentPrompt = "talk about the product, not the printer";

    const res = await PUT(request("PUT", payload));

    expect(res.status).toBe(200);
    expect(mocks.validateEndpoint).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        settings: expect.objectContaining({
          voiceAgentPrompt: "talk about the product, not the printer",
          ariHost: "host",
        }),
      }),
    }));
  });

  it("still runs the network policy when the endpoint itself is edited", async () => {
    mocks.validateEndpoint.mockRejectedValue(new Error("private address"));
    mocks.findFirst.mockResolvedValue(row);
    const payload = asteriskPayload({ id: "voip_1" });
    payload.settings.ariPort = 8089;

    const res = await PUT(request("PUT", payload));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "VoIP endpoint is not allowed by outbound network policy",
    });
    expect(mocks.validateEndpoint).toHaveBeenCalledOnce();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("fails closed when the endpoint moves between the unlocked read and the lock", async () => {
    mocks.validateEndpoint.mockRejectedValue(new Error("private address"));
    mocks.findFirst
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce({ ...row, settings: { ...row.settings, ariHost: "moved" } });
    const payload = asteriskPayload({ id: "voip_1" });
    payload.settings.voiceAgentPrompt = "talk about the product";

    const res = await PUT(request("PUT", payload));

    expect(res.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects bearer/API-key access before reading or mutating provider settings", async () => {
    const getRes = await GET(request("GET", undefined, true));
    const putRes = await PUT(request("PUT", asteriskPayload(), true));

    expect(getRes.status).toBe(403);
    expect(putRes.status).toBe(403);
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
