import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withRlsAuth } from "@/lib/with-rls";
import { publicChannelConfig } from "@/lib/channels/public-channel-config";
import {
  validateVoipSettingsEndpoint,
  voipEndpointFingerprint,
} from "@/lib/voip/endpoint-guard";

export const dynamic = "force-dynamic";

const commonSettings = z.object({
  recordCalls: z.boolean().default(false),
  voiceAgentEnabled: z.boolean().default(false),
  manualLeadAiCallsEnabled: z.boolean().default(false),
  voiceQueueEnabled: z.boolean().default(false),
  voiceAgentMode: z.enum(["inbound", "outbound", "both"]).default("outbound"),
  voiceAgentPrompt: z.string().trim().max(20_000).default(""),
  voiceAgentKnowledge: z.string().max(100_000).default(""),
});

const settingsSchema = z.discriminatedUnion("provider", [
  commonSettings.extend({
    provider: z.literal("twilio"),
    accountSid: z.string().max(500).default(""),
    authToken: z.string().max(2_000).default(""),
    twilioNumber: z.string().max(100).default(""),
  }).strict(),
  commonSettings.extend({
    provider: z.literal("threecx"),
    serverUrl: z.string().max(2_000).default(""),
    extension: z.string().max(200).default(""),
    clientId: z.string().max(500).default(""),
    apiKey: z.string().max(2_000).default(""),
    webhookSecret: z.string().max(2_000).default(""),
  }).strict(),
  commonSettings.extend({
    provider: z.literal("asterisk"),
    ariHost: z.string().max(2_000).default(""),
    ariPort: z.number().int().min(1).max(65_535).default(8088),
    username: z.string().max(500).default(""),
    password: z.string().max(2_000).default(""),
    context: z.string().max(500).default("from-internal"),
    callerExtension: z.string().max(200).default(""),
  }).strict(),
  commonSettings.extend({
    provider: z.literal("custom-sip"),
    sipServer: z.string().max(2_000).default(""),
    sipPort: z.number().int().min(1).max(65_535).default(5060),
    sipDomain: z.string().max(500).default(""),
    transport: z.enum(["udp", "tcp", "tls", "wss"]).default("wss"),
    username: z.string().max(500).default(""),
    secret: z.string().max(2_000).default(""),
  }).strict(),
]);

const configSchema = z
  .object({
    id: z.string().min(1).max(200).optional(),
    configName: z.string().trim().min(1).max(200),
    phoneNumber: z.string().max(100).optional().default(""),
    isActive: z.boolean().default(false),
    settings: settingsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.settings.voiceAgentEnabled && !value.settings.voiceAgentPrompt) {
      ctx.addIssue({
        code: "custom",
        path: ["settings", "voiceAgentPrompt"],
        message: "AI conversation rules are required while the voice agent is enabled",
      });
    }
    const outboundAsteriskReady = (
      value.settings.provider !== "asterisk"
      || !value.settings.voiceAgentEnabled
      || value.settings.voiceAgentMode === "inbound"
    ) === false;
    if (value.settings.manualLeadAiCallsEnabled && !outboundAsteriskReady) {
      ctx.addIssue({
        code: "custom",
        path: ["settings", "manualLeadAiCallsEnabled"],
        message: "Manual lead AI calls require outbound Asterisk voice-agent mode",
      });
    }
    if (
      value.settings.voiceQueueEnabled
      && (!outboundAsteriskReady || !value.settings.manualLeadAiCallsEnabled)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["settings", "voiceQueueEnabled"],
        message: "Sequential AI call queues require manual outbound Asterisk AI calls",
      });
    }
  });

const canonicalOrder = [
  { updatedAt: "desc" as const },
  { createdAt: "desc" as const },
  { id: "desc" as const },
];

function settingsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const PRESERVE_BLANK_SECRET_KEYS = ["authToken", "apiKey", "webhookSecret", "password", "secret"];

function mergeSameProviderSettings(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...existing, ...incoming };
  for (const key of PRESERVE_BLANK_SECRET_KEYS) {
    if (
      incoming[key] === ""
      && typeof existing[key] === "string"
      && existing[key].trim()
    ) {
      merged[key] = existing[key];
    }
  }
  return merged;
}

function routeError(error: unknown) {
  console.error("[voip-config] route error:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

function privateJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function rejectApiCredential(req: Request): NextResponse | null {
  return req.headers.has("authorization")
    ? NextResponse.json({ error: "Session authentication required" }, { status: 403 })
    : null;
}

/** Admin-only provider setup that is scoped to the VoIP add-on, not Inbox. */
export const GET = withRlsAuth("voip", "admin", async (req, auth) => {
  const apiCredentialError = rejectApiCredential(req);
  if (apiCredentialError) return apiCredentialError;
  try {
    const config = await prisma.channelConfig.findFirst({
      where: { organizationId: auth.orgId, channelType: "voip" },
      orderBy: canonicalOrder,
    });
    return privateJson({
      success: true,
      data: config ? publicChannelConfig(config, { revealVoipSettings: true }) : null,
    });
  } catch (error) {
    return routeError(error);
  }
});

export const PUT = withRlsAuth("voip", "admin", async (req, auth) => {
  const apiCredentialError = rejectApiCredential(req);
  if (apiCredentialError) return apiCredentialError;
  const body = await req.json().catch(() => ({}));
  const parsed = configSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  // Reject unsafe/unresolvable tenant endpoints before opening a DB
  // transaction. Runtime requests repeat the same DNS policy and pin the
  // validated address, so legacy rows cannot bypass this write-time gate.
  //
  // A save that leaves the endpoint byte-identical is not such a write: the
  // stored origin goes back exactly as it came out, and re-probing it only
  // decides whether the administrator may edit the OTHER fields on the page.
  // Production showed what that costs. One legacy Asterisk origin outside
  // VOIP_PRIVATE_ENDPOINT_ALLOWLIST failed every PUT with a network-policy
  // error, so weeks of AI-prompt edits were discarded before reaching the
  // transaction while the voice agent kept answering from the last saved text.
  const incomingEndpoint = voipEndpointFingerprint(parsed.data.settings);
  const priorConfig = await prisma.channelConfig.findFirst({
    where: parsed.data.id
      ? { id: parsed.data.id, organizationId: auth.orgId, channelType: "voip" }
      : { organizationId: auth.orgId, channelType: "voip" },
    orderBy: canonicalOrder,
    select: { settings: true },
  });
  const endpointUnchanged = incomingEndpoint !== null
    && incomingEndpoint === voipEndpointFingerprint(settingsRecord(priorConfig?.settings));
  if (!endpointUnchanged) {
    try {
      await validateVoipSettingsEndpoint(parsed.data.settings);
    } catch {
      return NextResponse.json(
        { error: "VoIP endpoint is not allowed by outbound network policy" },
        { status: 400 },
      );
    }
  }
  const pilotOrganizationId = process.env.VOICE_AGENT_ORGANIZATION_ID?.trim() || "";

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // pg_advisory_xact_lock returns PostgreSQL void.  `$queryRaw` attempts to
      // deserialize that value and fails in production; `$executeRaw` keeps the
      // same transaction-scoped lock without reading a result row.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`voip-config:${auth.orgId}`}, 0))`;

      const existing = parsed.data.id
        ? await tx.channelConfig.findFirst({
            where: {
              id: parsed.data.id,
              organizationId: auth.orgId,
              channelType: "voip",
            },
          })
        : await tx.channelConfig.findFirst({
            where: { organizationId: auth.orgId, channelType: "voip" },
            orderBy: canonicalOrder,
          });

      if (parsed.data.id && !existing) {
        return { notFound: true as const, staleEndpoint: false as const, config: null };
      }

      const incomingSettings = parsed.data.settings as unknown as Record<string, unknown>;
      const existingSettings = settingsRecord(existing?.settings);
      const providerChanged = Boolean(
        existing
        && existingSettings.provider
        && existingSettings.provider !== incomingSettings.provider,
      );
      const settings = existingSettings.provider === incomingSettings.provider
        ? mergeSameProviderSettings(existingSettings, incomingSettings)
        : incomingSettings;
      // The locked row above is the authoritative one; the unlocked read that
      // let this save skip validation is not. If they disagree, the endpoint
      // moved underneath us and this write would persist an origin nobody
      // probed, so fail closed and let the client resubmit against the row it
      // can now see.
      if (
        endpointUnchanged
        && voipEndpointFingerprint(settings) !== voipEndpointFingerprint(existingSettings)
      ) {
        return { notFound: false as const, staleEndpoint: true as const, config: null };
      }
      if (
        incomingSettings.provider === "asterisk"
        && auth.orgId !== pilotOrganizationId
        && settings.voiceAttemptRegistryEnabled === true
      ) {
        // Fail closed if the configured pilot changes while an older tenant
        // row still carries the capability. An ordinary UI save must not keep
        // that stale row eligible for the global runtime key.
        settings.voiceAttemptRegistryEnabled = false;
      }
      const data = {
        configName: parsed.data.configName,
        phoneNumber: parsed.data.phoneNumber.trim() || null,
        isActive: parsed.data.isActive,
        settings: settings as Prisma.InputJsonValue,
        // A legacy top-level apiKey may be a provider credential fallback. It
        // must not be reinterpreted as the new provider's secret after a switch.
        ...(providerChanged ? { apiKey: null } : {}),
      };

      const config = existing
        ? await tx.channelConfig.update({ where: { id: existing.id }, data })
        : await tx.channelConfig.create({
            data: {
              organizationId: auth.orgId,
              channelType: "voip",
              createdBy: auth.userId ?? null,
              ...data,
            },
          });
      return { notFound: false as const, staleEndpoint: false as const, config };
    });

    if (result.staleEndpoint) {
      return NextResponse.json(
        { error: "VoIP endpoint changed during the save. Reload the page and try again." },
        { status: 409 },
      );
    }
    if (result.notFound || !result.config) {
      return NextResponse.json({ error: "VoIP configuration not found" }, { status: 404 });
    }
    return privateJson({
      success: true,
      data: publicChannelConfig(result.config, { revealVoipSettings: true }),
    });
  } catch (error) {
    return routeError(error);
  }
});
