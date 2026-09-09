import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { sanitizeOwnedRefs } from "@/lib/verify-owned-refs"
import { getVoipProvider } from "@/lib/voip"
import {
  isOutboundVoiceDispatchPaused,
  OUTBOUND_VOICE_DISPATCH_PAUSED_CODE,
} from "@/lib/voip/outbound-dispatch-gate"
import {
  assertOutboundVoiceDispatchAllowed,
  OutboundVoiceDispatchPausedError,
} from "@/lib/voip/outbound-dispatch-lock"
import { exposeVoipProvider, missingVoipFields, normalizeVoipSettings, voipFromNumber, type ExposedVoipProvider } from "@/lib/voip/configs"
import { accessibleCallWhere, callAccessScope, exposeCallForClient } from "@/lib/calls/access"
import { normalizeManualLeadPhone } from "@/lib/voice-agent/manual-lead-call"
import { browserSoftphoneAllowed, issueParkTicket } from "@/lib/voip/browser-softphone"
import { BROWSER_LEAD_CALL_CLAIM_LEASE_MS } from "@/lib/voip/browser-lead-claim"
import { getOrgModuleContext } from "@/lib/api-auth"
import {
  buildUnresolvedOutboundCallWhere,
  PROVIDER_UNKNOWN_NO_REDIAL,
} from "@/lib/voice-agent/unresolved-call"
import {
  lockVoiceContactPermission,
  lockVoiceLeadRow,
} from "@/lib/voice-agent/voice-permission-lock"
import { isManagerOrAbove } from "@/lib/constants"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"

type VoipConfigForCall = {
  id: string
  configName: string
  phoneNumber: string | null
  apiKey: string | null
  settings: Prisma.JsonValue | null
  isActive: boolean
}

function parseRequestedProvider(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null
}

function callFailureNote(providerName: string, error: string): string {
  return `[VoIP failure] ${providerName}: ${error}`
}

type CallLogWhereWithConversation = Prisma.CallLogWhereInput & {
  conversationId?: string
}
type CallLogWithContact = Prisma.CallLogGetPayload<{
  include: {
    contact: { select: { fullName: true; email: true } }
  }
}>

class VoiceContactBlockedError extends Error {}
class LinkedLeadNotFoundError extends Error {}
class LinkedLeadPhoneMismatchError extends Error {}
class HumanCallIdempotencyConflictError extends Error {}
class ActiveVoiceCallError extends Error {}
class LeadCallClaimedError extends Error {}

const CLIENT_IDEMPOTENCY_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type HumanCallReplay = Prisma.CallLogGetPayload<{
  select: {
    id: true
    direction: true
    fromNumber: true
    toNumber: true
    targetPhoneE164: true
    status: true
    contactId: true
    conversationId: true
    leadId: true
    companyId: true
    dealId: true
    ticketId: true
    userId: true
    provider: true
    callSid: true
    channelConfigId: true
    callMode: true
    providerOutcome: true
    conversationOutcome: true
    endedAt: true
  }
}>

function replayMatchesRequest(
  call: HumanCallReplay,
  expected: {
    userId: string
    fromNumber: string
    toNumber: string
    targetPhoneE164: string
    provider: string
    channelConfigId: string
    contactId?: string
    conversationId?: string
    leadId?: string
    companyId?: string
    dealId?: string
    ticketId?: string
  },
): boolean {
  return call.direction === "outbound"
    && call.callMode === "human"
    && call.userId === expected.userId
    && call.fromNumber === expected.fromNumber
    // Destination identity is targetPhoneE164, which is shape-stable across
    // deploys. toNumber is the dial-string spelling of that same number, and
    // its format changed once already (entered form → digits-only
    // international): a raw comparison made a retry that straddled the deploy
    // 409 instead of replaying the row it had already created.
    && call.targetPhoneE164 === expected.targetPhoneE164
    && call.provider === expected.provider
    && call.channelConfigId === expected.channelConfigId
    && call.contactId === (expected.contactId || null)
    && call.conversationId === (expected.conversationId || null)
    && call.leadId === (expected.leadId || null)
    && call.companyId === (expected.companyId || null)
    && call.dealId === (expected.dealId || null)
    && call.ticketId === (expected.ticketId || null)
}

function replayHumanCall(call: HumanCallReplay, providerConfigId: string) {
  if (call.conversationOutcome === PROVIDER_UNKNOWN_NO_REDIAL) {
    return NextResponse.json({
      error: "call_outcome_unknown_no_redial",
      callLogId: call.id,
      replayed: true,
    }, { status: 409 })
  }
  if (call.providerOutcome && call.providerOutcome !== "connected") {
    return NextResponse.json({
      error: "call_already_terminal",
      callLogId: call.id,
      status: call.status,
      replayed: true,
    }, { status: 409 })
  }
  return NextResponse.json({
    success: true,
    callLogId: call.id,
    callSid: call.callSid,
    provider: call.provider,
    providerConfigId,
    status: call.status,
    replayed: true,
  })
}

// POST — initiate an outbound call via configured VoIP provider
export const POST = withRlsAuth("voip", "write", async (req, auth) => {
  const orgId = auth.orgId
  const mutationGuard = guardInteractiveJsonMutation(req)
  if (mutationGuard) return mutationGuard
  const clientIdempotencyKey = req.headers.get("idempotency-key")?.trim() || ""
  if (!CLIENT_IDEMPOTENCY_KEY_RE.test(clientIdempotencyKey)) {
    return NextResponse.json({ error: "valid_idempotency_key_required" }, { status: 400 })
  }
  const idempotencyKey = `human-call:${auth.userId}:${clientIdempotencyKey.toLowerCase()}`
  if (isOutboundVoiceDispatchPaused(orgId)) {
    return NextResponse.json(
      { error: OUTBOUND_VOICE_DISPATCH_PAUSED_CODE },
      { status: 503, headers: { "Retry-After": "60" } },
    )
  }
  const {
    toNumber,
    contactId: rawContactId,
    companyId: rawCompanyId,
    dealId: rawDealId,
    leadId: rawLeadId,
    ticketId: rawTicketId,
    conversationId: rawConversationId,
    providerConfigId: rawProviderConfigId,
    provider: rawRequestedProvider,
    voiceAgent: rawVoiceAgent,
    browserAudio: rawBrowserAudio,
  } = await req.json()
  if (rawVoiceAgent === true) {
    // AI calls require lead ownership, consent, hours, rate limits,
    // idempotency and an active-call fence. The generic click-to-call route
    // deliberately cannot bypass those controls.
    return NextResponse.json(
      { error: "manual_lead_ai_call_required" },
      { status: 409 },
    )
  }
  if (!toNumber) return NextResponse.json({ error: "toNumber is required" }, { status: 400 })
  const requestedProvider = parseRequestedProvider(rawRequestedProvider)
  if (!requestedProvider) {
    return NextResponse.json({
      error: "provider is required. Use provider=voip for regular phone calls. WhatsApp Calling uses /api/v1/calls/whatsapp/* actions.",
    }, { status: 400 })
  }
  if (requestedProvider === "whatsapp" || requestedProvider === "whatsapp_calling") {
    return NextResponse.json({
      error: "WhatsApp Calling is not started through /api/v1/calls. Wait for an inbound WhatsApp call or use the WhatsApp consent flow.",
    }, { status: 400 })
  }

  const browserAudio = rawBrowserAudio === true
  let activeBrowserLeadClaim: { leadId: string; token: string } | null = null
  let browserDispatchMayExist = false
  try {
    const normalizedTarget = normalizeManualLeadPhone(toNumber)
    if (!normalizedTarget) {
      // DNC is keyed by canonical external-party identity. Never let a raw,
      // provider-specific spelling bypass a stored phone-level block.
      return NextResponse.json({ error: "invalid_phone_number" }, { status: 400 })
    }
    const targetPhoneE164 = normalizedTarget.e164

    const voipConfigs = await prisma.channelConfig.findMany({
      where: { organizationId: orgId, channelType: "voip", isActive: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        configName: true,
        phoneNumber: true,
        apiKey: true,
        settings: true,
        isActive: true,
      },
    }) as VoipConfigForCall[]

    const exposedProviders = voipConfigs
      .map(exposeVoipProvider)
      .filter((provider): provider is ExposedVoipProvider => Boolean(provider))
    const readyProviders = exposedProviders.filter((provider) => provider.ready)

    if (voipConfigs.length === 0) {
      return NextResponse.json({ error: "VoIP not configured. Go to Settings → VoIP to set up." }, { status: 400 })
    }
    if (readyProviders.length === 0) {
      return NextResponse.json({
        error: "VoIP provider is not ready.",
        missingFields: Array.from(new Set(exposedProviders.flatMap((provider) => provider.missing))),
        providers: exposedProviders,
      }, { status: 400 })
    }

    let voipConfig: VoipConfigForCall | undefined
    if (typeof rawProviderConfigId === "string" && rawProviderConfigId.trim()) {
      voipConfig = voipConfigs.find((config) => config.id === rawProviderConfigId.trim())
      if (!voipConfig) {
        return NextResponse.json({ error: "Selected VoIP provider is not active for this tenant." }, { status: 404 })
      }
    } else if (readyProviders.length === 1) {
      voipConfig = voipConfigs.find((config) => config.id === readyProviders[0].id)
    } else {
      return NextResponse.json({
        error: "choose_call_provider",
        message: "Choose which VoIP provider to use for this call.",
        providers: readyProviders,
      }, { status: 409 })
    }

    const normalizedSettings = voipConfig ? normalizeVoipSettings(voipConfig, orgId) : null
    const missingFields = missingVoipFields(normalizedSettings)
    if (!voipConfig || !normalizedSettings || missingFields.length > 0) {
      return NextResponse.json({
        error: "VoIP provider is not ready.",
        missingFields,
      }, { status: 400 })
    }

    const providerName = normalizedSettings.provider
    if (!["voip", providerName.toLowerCase()].includes(requestedProvider)) {
      return NextResponse.json({
        error: `Configured VoIP provider is ${providerName}; requested provider=${requestedProvider} is not available for this tenant.`,
      }, { status: 400 })
    }

    const provider = getVoipProvider(normalizedSettings)
    const asteriskCorrelationId = providerName === "asterisk" ? randomUUID() : null

    // Determine fromNumber based on provider
    const fromNumber = voipFromNumber(normalizedSettings)

    // Org-validate ALL client-supplied refs (parity with whatsapp/send + inbox — #2 pattern).
    const { contactId, leadId, companyId, dealId, ticketId, conversationId } = await sanitizeOwnedRefs(orgId, {
      contactId: rawContactId,
      leadId: rawLeadId,
      companyId: rawCompanyId,
      dealId: rawDealId,
      ticketId: rawTicketId,
      conversationId: rawConversationId,
    })
    // Generated on the server, never inferred from a lead id. The client uses
    // it only to renew/release its own lease; a stale browser cannot clear a
    // claim acquired by a later browser after expiry.
    const leadCallClaimToken = browserAudio && leadId ? randomUUID() : null
    // This generic route is an outbound sales click-to-call surface. Client
    // supplied references are tenant-validated metadata, not proof that the
    // destination is a support call. Treat every request here as sales so an
    // unrelated ticket/conversation id cannot bypass a sales suppression.
    const permissionScopes = ["sales", "all"]

    // An Asterisk manual call rings a SECOND leg on our side after the customer
    // answers. With no usable personal number that leg goes to the
    // organisation's shared line, and when nobody picks up there the customer
    // has already answered into silence — measured in the PBX's own CDR on
    // 2026-08-23: of 14 calls with both legs recorded, 2 were
    // customer=ANSWERED / agent=NO ANSWER. The substitution was silent, which
    // is why nobody noticed for weeks.
    //
    // Refuse instead, BEFORE the customer's phone is dialled and before any row
    // is written: a refused click disturbs nobody, and the fix is thirty
    // seconds in the caller's own profile. Only Asterisk is affected; other
    // providers do not ring a second leg this way.
    // Read unconditionally: `agentLeg` in the reply tells the UI which phone is
    // about to ring, and every provider needs that answer. Gating the LOOKUP on
    // the provider (rather than only the refusal) silently made every Twilio
    // reply say "shared" and turned an untouched test red.
    const caller = await prisma.user.findFirst({
      where: { id: auth.userId, organizationId: orgId },
      select: { phone: true, verifiedPhone: true },
    })
    const callerNormalized = normalizeManualLeadPhone(caller?.verifiedPhone || caller?.phone)
    // Only Azerbaijani numbers route the agent leg. This is a toll-fraud bound,
    // not a formatting preference: a profile phone is self-service, and an
    // unrestricted value would let someone point the company's trunk at a
    // premium-rate line abroad by pressing "call".
    const agentNumber = callerNormalized && /^\+994\d{9}$/.test(callerNormalized.e164)
      ? callerNormalized.dialNumber
      : undefined
    // A browser call has no second leg to ring: the answered call is bridged to
    // the salesperson's browser instead. So the profile-number requirement
    // below does not apply to it — and cannot, since the whole point is to work
    // for people who have no company phone.
    //
    // Both switches must agree. The environment variable is the kill switch (a
    // restart puts every tenant back on the phone path); the organisation flag
    // is the rollout. A request that asks for browser audio without them is
    // refused rather than quietly served as a phone call: a salesperson waiting
    // at a silent browser while a phone rings somewhere else is the same defect
    // this whole change exists to remove.
    if (browserAudio) {
      // Read the tenant's modules only when a browser call is actually asked
      // for: this is the hot click-to-call path and the ordinary phone call has
      // no business paying for a lookup it does not use. The context is cached.
      const orgModules = await getOrgModuleContext(orgId).catch(() => null)
      // The pilot list narrows this to named salespeople during a rollout;
      // empty, it means the whole tenant and nothing changes.
      if (providerName !== "asterisk" || !browserSoftphoneAllowed(orgModules?.modules, auth.userId)) {
        return NextResponse.json({ error: "browser_calls_unavailable" }, { status: 422 })
      }
    }
    if (!browserAudio && providerName === "asterisk" && !agentNumber) {
      // Two different dead ends, two different sentences. "You have no number"
      // is fixed in thirty seconds; "your number is not one we can dial" is a
      // rule the profile form does not enforce, so saying which rule was broken
      // is the difference between a fix and a shrug.
      return NextResponse.json(
        { error: callerNormalized ? "agent_phone_unsupported" : "agent_phone_required" },
        { status: 422 },
      )
    }

    // This transaction is the linearization point shared with the DNC writer.
    // If the block wins the phone lock, no attempt row is created. If this
    // transaction wins, the attempt is durably started before a later block.
    const callAttempt = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`human-call-idempotency:${orgId}:${idempotencyKey}`}, 0))`
      const existing = await tx.callLog.findFirst({
        where: { organizationId: orgId, idempotencyKey },
        select: {
          id: true,
          direction: true,
          fromNumber: true,
          toNumber: true,
          targetPhoneE164: true,
          status: true,
          contactId: true,
          conversationId: true,
          leadId: true,
          companyId: true,
          dealId: true,
          ticketId: true,
          userId: true,
          provider: true,
          callSid: true,
          channelConfigId: true,
          callMode: true,
          providerOutcome: true,
          conversationOutcome: true,
          endedAt: true,
        },
      })
      if (existing) {
        if (!replayMatchesRequest(existing, {
          userId: auth.userId,
          fromNumber,
          toNumber: normalizedTarget.dialNumber,
          targetPhoneE164,
          provider: providerName,
          channelConfigId: voipConfig.id,
          contactId,
          conversationId,
          leadId,
          companyId,
          dealId,
          ticketId,
        })) {
          throw new HumanCallIdempotencyConflictError()
        }
        return { kind: "existing" as const, call: existing }
      }

      if (providerName === "asterisk") {
        await assertOutboundVoiceDispatchAllowed({
          tx,
          organizationId: orgId,
          channelConfigId: voipConfig.id,
        })
      }
      if (leadId) {
        await lockVoiceLeadRow(tx, orgId, leadId)
        const linkedLead = await tx.lead.findFirst({
          where: {
            id: leadId,
            organizationId: orgId,
            ...(!isManagerOrAbove(auth.role || "viewer")
              ? { assignedTo: auth.userId }
              : {}),
          },
          select: { phone: true },
        })
        if (!linkedLead) throw new LinkedLeadNotFoundError()
        const linkedPhone = normalizeManualLeadPhone(linkedLead.phone)
        if (!linkedPhone || linkedPhone.e164 !== targetPhoneE164) {
          // A browser-supplied lead id is metadata, not authority to attach a
          // different destination. Without this binding a connected call to A
          // could falsely mark unrelated lead B as already contacted.
          throw new LinkedLeadPhoneMismatchError()
        }
        if (leadCallClaimToken) {
          // This is the linearization point for the shared list. Do not read
          // availability and then write: the released/expired condition lives
          // in the same updateMany that installs this caller's lease.
          const now = new Date()
          const leadClaim = await tx.lead.updateMany({
            where: {
              id: leadId,
              organizationId: orgId,
              ...(!isManagerOrAbove(auth.role || "viewer")
                ? { assignedTo: auth.userId }
                : {}),
              OR: [
                { browserCallClaimExpiresAt: null },
                { browserCallClaimExpiresAt: { lte: now } },
              ],
            },
            data: {
              browserCallClaimToken: leadCallClaimToken,
              browserCallClaimedByUserId: auth.userId,
              browserCallClaimedAt: now,
              browserCallClaimExpiresAt: new Date(now.getTime() + BROWSER_LEAD_CALL_CLAIM_LEASE_MS),
            },
          })
          if (leadClaim.count !== 1) throw new LeadCallClaimedError()
        }
      }
      await lockVoiceContactPermission(tx, orgId, targetPhoneE164)
      const unresolvedCall = await tx.callLog.findFirst({
        where: buildUnresolvedOutboundCallWhere({
          organizationId: orgId,
          targetPhoneE164,
          callModes: ["human", "ai"],
        }),
        select: { id: true },
      })
      if (unresolvedCall) throw new ActiveVoiceCallError()
      const now = new Date()
      const [suppression, blockedConsent] = await Promise.all([
        tx.voiceSuppression.findFirst({
          where: {
            organizationId: orgId,
            phoneE164: targetPhoneE164,
            scope: { in: permissionScopes },
            isActive: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { id: true },
        }),
        tx.voiceConsent.findFirst({
          where: {
            organizationId: orgId,
            phoneE164: targetPhoneE164,
            scope: { in: permissionScopes },
            status: "blocked",
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          select: { id: true },
        }),
      ])
      if (suppression || blockedConsent) throw new VoiceContactBlockedError()

      const created = await tx.callLog.create({
        data: {
          organizationId: orgId,
          direction: "outbound",
          fromNumber,
          toNumber: normalizedTarget.dialNumber,
          targetPhoneE164,
          status: "initiated",
          provider: providerName,
          callMode: "human",
          // Persist the Asterisk observer correlation before ARI dispatch. A
          // fast answered/terminal callback can therefore bind immediately;
          // it never needs a phone or timing fallback.
          callSid: asteriskCorrelationId,
          providerCallId: asteriskCorrelationId,
          channelConfigId: voipConfig.id,
          contactId: contactId || null,
          conversationId: conversationId || null,
          companyId: companyId || null,
          dealId: dealId || null,
          ticketId: ticketId || null,
          leadId: leadId || null, // set by click-to-call from a lead card (Slice 3b)
          leadCallClaimToken,
          userId: auth.userId,
          idempotencyKey,
          startedAt: now,
        },
      })
      return { kind: "created" as const, call: created }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })

    if (callAttempt.kind === "existing") {
      return replayHumanCall(callAttempt.call, voipConfig.id)
    }
    const callLog = callAttempt.call
    if (leadId && leadCallClaimToken) {
      activeBrowserLeadClaim = { leadId, token: leadCallClaimToken }
    }

    // Ring the person who pressed the button, not one shared extension.
    //
    // This number becomes a real dial through the trunk, and unlike the org
    // setting it replaced, a profile phone is self-service: any user with
    // voip:write can edit their own. An unrestricted value would let someone
    // point the company's trunk at a premium-rate line abroad and pay for it
    // by pressing "call". The number itself is resolved and enforced earlier,
    // before the customer is dialled.
    // Once a request leaves this process, an exception is not proof that the
    // PBX did not receive it. Keep the browser lease unless the adapter returns
    // an explicit definite rejection; a dead tab is bounded by its TTL.
    browserDispatchMayExist = true
    // Initiate call via provider adapter
    const result = await provider.initiateCall({
      toNumber: normalizedTarget.dialNumber,
      fromNumber,
      agentNumber,
      twimlUrl: `${process.env.NEXTAUTH_URL}/api/v1/calls/twiml`,
      callbackUrl: `${process.env.NEXTAUTH_URL}/api/v1/calls/webhook`,
      record: normalizedSettings.recordCalls === true,
      voiceAgent: false,
      browserAudio,
      correlationId: asteriskCorrelationId || undefined,
    })
    browserDispatchMayExist = result.success || result.failureCertainty !== "definite_rejection"

    if (result.success && result.callSid) {
      await prisma.callLog.update({
        where: { id: callLog.id },
        data: {
          callSid: asteriskCorrelationId || result.callSid,
          providerCallId: asteriskCorrelationId || result.callSid,
        },
      })
      return NextResponse.json({
        success: true,
        callLogId: callLog.id,
        callSid: asteriskCorrelationId || result.callSid,
        provider: providerName,
        providerConfigId: voipConfig.id,
        ...(leadCallClaimToken ? { leadCallClaimToken } : {}),
        // Which phone will ring on our side. The UI must not promise "yours"
        // when the caller has no usable number and the shared line answers —
        // that mismatch is what makes a rep click twice and dial the customer
        // a second time.
        // Asterisk callers without a usable number never reach this point, so
        // "shared" here only ever describes a provider that does not ring a
        // second leg of ours at all. A browser call rings no leg at all.
        agentLeg: browserAudio ? "browser" : agentNumber ? "own" : "shared",
        // Minted only now, so it can name a call that exists. It is the
        // browser's proof at the relay; the call id alone is not, because every
        // colleague can already read that from the call list.
        ...(browserAudio
          ? {
              parkTicket: issueParkTicket({ orgId, userId: auth.userId, callLogId: callLog.id }),
              // The SERVER names the relay, not the browser. Measured on
              // 2026-08-23: the public host is ~76 ms away from both the office
              // and the station, which are 8 ms from each other. So which relay
              // a salesperson is sent to decides whether the call feels natural
              // — and that is a decision to make here, where the office can
              // eventually be told apart from a laptop in a car, rather than
              // baked into the bundle.
              relayUrl: process.env.SOFTPHONE_RELAY_URL || null,
            }
          : {}),
      })
    } else {
      const failure = result.error || "Failed to initiate call"
      const deliveryUncertain = result.failureCertainty === "unknown_delivery"
      await prisma.callLog.updateMany({
        // A fast PBX lifecycle callback may win this race. Never overwrite
        // proven answer/terminal evidence with the HTTP dispatch result.
        where: {
          id: callLog.id,
          organizationId: orgId,
          providerOutcome: null,
          wasAnswered: false,
          endedAt: null,
        },
        data: deliveryUncertain
          ? {
              // Keep the row non-terminal: the PBX observer may still prove
              // that a timed-out request was accepted and completed.
              notes: callFailureNote(providerName, failure),
            }
          : {
              status: "failed",
              wasAnswered: false,
              providerOutcome: "failed",
              endedAt: new Date(),
              notes: callFailureNote(providerName, failure),
            },
      })
      if (result.failureCertainty === "definite_rejection" && activeBrowserLeadClaim) {
        await prisma.lead.updateMany({
          where: {
            id: activeBrowserLeadClaim.leadId,
            organizationId: orgId,
            browserCallClaimToken: activeBrowserLeadClaim.token,
          },
          data: {
            browserCallClaimToken: null,
            browserCallClaimedByUserId: null,
            browserCallClaimedAt: null,
            browserCallClaimExpiresAt: null,
          },
        })
      }
      return NextResponse.json(
        // Name the call even while refusing it. When delivery is uncertain the
        // customer may already be ringing, and a browser that cannot say WHICH
        // call to cancel cannot cancel it.
        { error: failure, callLogId: callLog.id },
        { status: deliveryUncertain ? 503 : 500 },
      )
    }
  } catch (e) {
    if (activeBrowserLeadClaim && !browserDispatchMayExist) {
      await prisma.lead.updateMany({
        where: {
          id: activeBrowserLeadClaim.leadId,
          organizationId: orgId,
          browserCallClaimToken: activeBrowserLeadClaim.token,
        },
        data: {
          browserCallClaimToken: null,
          browserCallClaimedByUserId: null,
          browserCallClaimedAt: null,
          browserCallClaimExpiresAt: null,
        },
      }).catch(() => {})
    }
    if (e instanceof OutboundVoiceDispatchPausedError) {
      return NextResponse.json(
        { error: OUTBOUND_VOICE_DISPATCH_PAUSED_CODE },
        { status: 503, headers: { "Retry-After": "60" } },
      )
    }
    if (e instanceof LinkedLeadNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    if (e instanceof LinkedLeadPhoneMismatchError) {
      return NextResponse.json({ error: "lead_phone_mismatch" }, { status: 409 })
    }
    if (e instanceof VoiceContactBlockedError) {
      return NextResponse.json({ error: "voice_contact_blocked" }, { status: 409 })
    }
    if (e instanceof HumanCallIdempotencyConflictError) {
      return NextResponse.json({ error: "idempotency_key_conflict" }, { status: 409 })
    }
    if (e instanceof ActiveVoiceCallError) {
      return NextResponse.json({ error: "active_voice_call_exists" }, { status: 409 })
    }
    if (e instanceof LeadCallClaimedError) {
      return NextResponse.json({ error: "lead_call_claimed" }, { status: 409 })
    }
    console.error("Call initiation error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// GET — call history with filters and pagination
export const GET = withRls(async (req, { orgId, session }) => {
  const { searchParams } = new URL(req.url)
  const contactId = searchParams.get("contactId")
  const conversationId = searchParams.get("conversationId")
  const companyId = searchParams.get("companyId")
  const direction = searchParams.get("direction")
  const status = searchParams.get("status")
  const provider = searchParams.get("provider")
  const ticketId = searchParams.get("ticketId")
  const callSid = searchParams.get("callSid")
  const id = searchParams.get("id")
  const search = searchParams.get("search")
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25")))

  const where: CallLogWhereWithConversation = {
    organizationId: orgId,
    AND: [accessibleCallWhere(session?.role || "viewer", session?.userId)],
  }
  if (contactId) where.contactId = contactId
  if (conversationId) where.conversationId = conversationId
  if (companyId) where.companyId = companyId
  if (ticketId) where.ticketId = ticketId
  if (direction) where.direction = direction
  if (status) where.status = status
  if (provider) where.provider = provider
  if (callSid) where.callSid = callSid
  if (id) where.id = id
  if (search) {
    where.OR = [
      { fromNumber: { contains: search, mode: "insensitive" } },
      { toNumber: { contains: search, mode: "insensitive" } },
    ]
  }

  try {
    const [calls, total] = await Promise.all([
      prisma.callLog.findMany({
        where,
        include: {
          contact: { select: { fullName: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.callLog.count({ where }),
    ])
    const safeCalls = calls.map((call: CallLogWithContact) => ({
      ...exposeCallForClient(call),
      accessScope: callAccessScope(call),
    }))

    return NextResponse.json({
      success: true,
      data: safeCalls,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (e) {
    console.error("Call history error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
