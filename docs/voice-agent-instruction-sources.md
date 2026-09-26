# Voice-agent instruction sources

The effective instruction for a CRM-managed AI phone call has three explicit layers:

1. **Conversation rules** — the administrator-managed `voiceAgentPrompt` field in VoIP settings. It defines role, tone, qualification flow, boundaries and handoff behaviour.
2. **Company and product knowledge** — the separate administrator-managed `voiceAgentKnowledge` field. It contains only approved facts the assistant may use during a call.
3. **Technical voice policy** — the immutable PBX runtime policy identified in CRM as `fanum-voice-policy-v1`. It is not a product knowledge source and cannot add prices or commercial facts.

The VoIP settings page shows a read-only, localized description of that policy beside the same identifier. Version `fanum-voice-policy-v1` corresponds to the runtime's fixed delivery and live-conversation rules:

- respond to the customer's latest statement before choosing a relevant next question; never read a fixed question list or re-ask supplied information;
- stop speaking immediately when the customer starts, and listen until the customer finishes;
- never invent an unknown answer; say briefly that a manager will clarify it;
- introduce the assistant, company and virtual-assistant status only in the first response, even when that response is interrupted;
- use a lively, confident and friendly professional female delivery, slightly more energetic than a medium pace, with natural literary Azerbaijani rhythm and clear `ə`, `ı`, `ö`, `ü`, `ğ`, `x` and `q` pronunciation; do not imitate American/English intonation, an artificial accent, or monotonous/mechanical reading;
- deliver every question as a short separate sentence ending in `?`, with stress on the question word and a slight natural final rise; use only short natural punctuation pauses and no unnecessary long pauses between words.

Any semantic change to those fixed runtime rules requires a new policy version and matching localized UI copy. The admin API does not return the raw internal PBX policy.

The CRM runtime endpoint combines the first two fields into one labelled payload. A legacy stored empty conversation-rules field is displayed and served as the same visible application default. New updates cannot enable the voice agent with an empty conversation-rules field. The endpoint returns no credentials, lead data, customer history or raw internal PBX policy.

The phone runtime has no web-search or knowledge-base tool. General facts may still come from the model's pretrained knowledge, so the conversation rules require it not to invent company-specific prices, availability, discounts or delivery promises. Approved commercial facts must be stored in the product-knowledge field.

When CRM-managed mode is configured, an unavailable runtime endpoint, an explicit disable, or an empty effective prompt returned by that endpoint must block a new AI session. The PBX must not silently replace it with a hidden local product prompt.

## Per-call prompt (2026-09-21)

The organisation's prompt is one identity for every call on its line. On
LeadDrive Inc.'s line that identity currently belongs to another business's
sales calls, so a call the **demo** places must not use it. The owner decided
the fix belongs to the call, not the line: the PBX asks for the prompt of each
call, and the CRM answers per call.

### What the PBX must do

For **every** AI session, before the agent speaks, request:

```
GET /api/internal/voice-agent/runtime-config?callId=<callId>
Authorization: Bearer <FANUM_VOICE_RUNTIME_TOKEN>
```

`<callId>` is the UUID the CRM minted before originating — the same
`correlationId` the CRM passed when it placed the call, and the same id the
PBX already sends to `call-source`, `call-continuation` and `call-result`.

Use the `prompt` of **that** response for **that** session. Do not cache it
across calls: two consecutive calls can legitimately get different prompts.

### What the CRM answers

| Request | `prompt` | `variant` |
|---|---|---|
| no `callId` (today's PBX) | the organisation's prompt, exactly as before | absent |
| `callId` of a call the demo placed | the demo's approved script (`src/lib/demo-center/call-prompt.ts`) | `"demo"` |
| `callId` of any other known call | the organisation's prompt | `"default"` |
| `callId` the CRM has no record of | the organisation's prompt | `"default"` |
| `callId` that is not a UUID | HTTP 400 | — |

`enabled` and `technicalVoicePolicyVersion` keep their meaning. The fixed
runtime policy (`fanum-voice-policy-v1`) still applies on top of either prompt.

Each per-call answer is recorded once per call as a `voice_runtime_prompt_served`
call event with the variant served. The demo will not place a live call until
such an event exists for the line — that is how the CRM knows the PBX asks per
call at all. The first demo call to the owner's own phone is the acceptance
test that the PBX also *uses* the answer.
