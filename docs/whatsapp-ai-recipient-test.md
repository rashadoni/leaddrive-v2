# Native WhatsApp AI recipient test

This temporary administrative test exercises the real native support AI webhook
and sender. It does not enable channel-wide AI or change other tenants' policies.
No schema migration is needed. No recipient is hardcoded in source.

## Preconditions

- An administrator with a browser session in the correct organization.
- An active native WhatsApp channel explicitly in `replyMode: "agent"`.
- An existing open, unassigned WhatsApp conversation on that exact channel.
- The consenting tester's full international phone must match the conversation.
- Neither conversation metadata nor contact preferences may indicate opt-out.
- Normal support AI, budget, rollout, quality and conversation caps still apply.
  The test does not bypass them or any earlier flow/rule/demo ownership.

## Internal administrative API

`POST /api/v1/whatsapp/ai-test` with JSON:

```json
{"channelConfigId":"existing-channel","conversationId":"existing-conversation","phone":"+15550001001"}
```

This only arms the test. A subsequent genuine incoming text invokes the normal
native AI handler. The run expires after 20 minutes and permits at most three
generation attempts. Attempts are consumed before generation and are never
refunded on failure. JSON compare-and-swap prevents parallel over-allocation and
preserves unrelated channel settings. A second active run is rejected, including
an exhausted run; stop it explicitly before starting another one.

`GET /api/v1/whatsapp/ai-test?channelConfigId=existing-channel` returns a safe view:
run ID, conversation ID, last four phone digits, expiry, attempts and active state.
It never returns credentials, other settings or the full phone. Read this after
any uncertain write; do not blindly retry activation.

`DELETE /api/v1/whatsapp/ai-test` with `{"channelConfigId":"existing-channel"}`
removes only the test. It is idempotent and retains manual reply mode. Start and
stop are audited. API keys cannot impersonate a browser administrator here.

## Fail-closed behavior

A test property, even malformed/expired/exhausted, overrides the legacy global AI
policy. It never falls through to channel-wide AI. Fresh checks require the same
organization, channel, conversation, complete phone, run and owned attempt. They
also recheck expiry, manual mode, human takeover and opt-out before native AI
side effects and immediately before sending. Stop/expiry during generation
suppresses the eventual send. A provider request already in flight cannot be
recalled; its recipient remains the bound tester.

Accepted AI outbounds carry `aiAutoReply: true` and `aiTestRunId` in message
metadata. Confirm those plus the exact sender/recipient and delivery status;
a manual AI-assisted draft does not prove the automatic path. After verification,
stop the test, re-read state and confirm the channel remains in agent mode.

## Verification

Unit/API tests cover phone and tenant boundaries, malformed/expired/exhausted
runs, opt-out, human takeover, stale snapshots, concurrent settings edits,
budget exhaustion and legacy-policy preservation. The real PostgreSQL test is
opt-in and rejects non-local or non-disposable database URLs:

```sh
WHATSAPP_AI_TEST_DATABASE_URL=postgresql://tester@127.0.0.1:5432/whatsapp_ai_test \
  npx vitest run src/__tests__/lib-whatsapp-ai-test-postgres.test.ts
```

It creates and drops only a unique fixture schema in that scratch database,
exercises the actual Prisma JSON CAS under 20 concurrent claims, verifies at most
three allocations and checks stop invalidation. Never point it at production.
