# Azerbaijani AI Voice Operator Architecture

Status: draft
Related docs:

- `docs/voice-core-architecture.md`
- `docs/voice-core-implementation-plan.md`

## Goal

Build a premium Azerbaijani-speaking AI operator for LeadDrive calls that sounds calm, local, intelligent, and useful in short sales/support conversations.

The target is not a cheap robotic IVR. The target is a controlled voice agent that can:

- speak clean Azerbaijani with local phrasing;
- understand Azerbaijani customer speech over phone audio;
- handle interruption and corrections;
- keep latency low enough for a natural call;
- follow scenario goals without sounding scripted;
- update LeadDrive tickets, conversations, leads, and tasks through validated actions;
- hand off to a human when needed.

Important product rule: do not design this as "deceive the customer at any cost." The experience can sound natural, but the system must remain safe, auditable, and able to identify itself according to tenant policy.

## Current Provider Reality

As of 2026-06-29:

- Azure Speech supports Azerbaijani `az-AZ` speech to text and has Azerbaijani neural voices `az-AZ-BanuNeural` and `az-AZ-BabekNeural`.
- Google Cloud Speech-to-Text supports Azerbaijani `az-AZ` through Chirp/Chirp 2 and Chirp 3 is listed in preview for `az-AZ`; Gemini-TTS lists Azerbaijani `az-AZ` in preview.
- ElevenLabs lists Azerbaijani support for Eleven v3 TTS and Scribe STT supports Azerbaijani.
- OpenAI Realtime is strong for voice-agent orchestration and low-latency session control, but OpenAI's built-in TTS voices are documented as optimized for English, so Azerbaijani voice quality must be tested rather than assumed.

Conclusion: the best architecture is not a single vendor. Use a pluggable voice pipeline and benchmark Azerbaijani quality with real Baku phone audio before choosing defaults.

## Recommended Stack Strategy

Use three tiers:

1. Premium Quality Path
   - STT: benchmark Azure `az-AZ`, Google Chirp 2/3, ElevenLabs Scribe, OpenAI realtime transcription.
   - Brain: LeadDrive scenario engine + LLM.
   - TTS: ElevenLabs Eleven v3 with Azerbaijani voice clone or best native Azerbaijani voice found during tests.
   - Use for sales, CSAT, complaint calls where voice quality matters.

2. Low-Latency Path
   - STT: fastest reliable Azerbaijani STT from benchmark.
   - Brain: smaller/low-latency LLM mode and stricter scenario graph.
   - TTS: fastest acceptable Azerbaijani voice or cached phrase playback.
   - Use for high-volume routine calls.

3. Fallback Path
   - If premium TTS/STT fails, use Azure Azerbaijani voices or pre-recorded phrases.
   - If AI brain fails, transfer/handoff or send WhatsApp/SMS fallback.

Do not make provider choice hard-coded. Store provider choice per tenant, scenario, and voice profile.

## Voice Persona Runtime

Add a `VoicePersona` layer above Voice Core.

Core responsibilities:

- persona configuration;
- language and dialect policy;
- phrase style guide;
- pronunciation dictionary;
- filler and backchannel policy;
- turn-taking settings;
- interruption handling;
- emotional tone boundaries;
- escalation rules;
- voice model selection;
- quality metrics.

Suggested models:

- `VoicePersona`
  - `organizationId`
  - `name`
  - `language`: `az-AZ`
  - `style`: `support | sales | csat | complaint | appointment`
  - `voiceProvider`
  - `voiceId`
  - `sttProvider`
  - `llmProfile`
  - `pronunciationDictionary`
  - `phraseBank`
  - `latencyMode`: `premium | balanced | fast`
  - `disclosurePolicy`
  - `status`

- `VoiceQualitySample`
  - `personaId`
  - test phrase
  - generated audio URL
  - human rating fields
  - WER/latency fields
  - approval status

- `VoiceBenchmarkRun`
  - provider/model
  - audio dataset version
  - WER
  - turn latency
  - TTS generation latency
  - human naturalness score
  - accent score
  - selected/not selected

## Azerbaijani Naturalness Requirements

The system needs language design, not only TTS.

Rules:

- Use Azerbaijani Latin text as the canonical script.
- Store tenant glossary for product names, brands, streets, cities, and staff names.
- Add pronunciation overrides for common misread terms.
- Avoid literal Russian/English translation patterns.
- Use short sentences.
- Avoid over-formal legal wording unless the scenario requires it.
- Use natural service phrases:
  - "Sizi narahat etdiyim üçün üzr istəyirəm."
  - "Müraciətinizlə bağlı bir neçə məlumatı dəqiqləşdirmək istəyirəm."
  - "Sizə hansı vaxt zəng etmək daha rahat olar?"
  - "Probleminiz tam həll olundumu?"
  - "İstəsəniz, bunu menecerə yönləndirə bilərəm."

Do not let the LLM freely improvise all speech. Use a phrase-bank plus controlled variation.

## Conversation Brain

Use a layered brain, not one prompt.

Layers:

1. Scenario Graph
   - deterministic states and required facts.
   - controls what the agent is trying to collect.

2. Dialogue Policy
   - decides next move:
     - ask
     - confirm
     - clarify
     - summarize
     - escalate
     - close

3. LLM Reasoning
   - handles messy customer speech.
   - extracts structured facts.
   - chooses wording from allowed style.

4. Action Validator
   - validates structured action before CRM write.
   - blocks unsafe or off-scenario action.

5. Human Handoff Gate
   - anger, legal threat, sensitive topic, repeated confusion, "operator istəyirəm", or low STT confidence.

## Turn-Taking And Latency

Natural calls fail when pauses are too long.

Targets:

- first greeting after answer: under 500-800 ms if possible;
- normal response after customer turn: under 1.2-1.8 seconds;
- interruption detection: under 300 ms;
- no long thinking silence. Use safe fillers only when useful.

Techniques:

- pre-generate greeting and common phrases;
- cache TTS for repeated scenario lines;
- stream STT partials;
- use barge-in detection;
- start preparing likely responses before final transcript;
- keep scenario state small;
- use low reasoning effort for routine turns;
- reserve deeper reasoning for after-call summary and CRM updates;
- keep phone media close to the SIP/provider region when possible.

## Handling Interruption

The agent must support barge-in.

Rules:

- Stop TTS immediately when customer starts speaking.
- Preserve what was already said.
- Recompute next step from latest partial transcript.
- If interruption is a correction, acknowledge and update fact.
- If interruption is anger, slow down and offer human transfer.

Example:

Customer: "Yox, mən artıq göndərmişəm."
Agent: "Başa düşdüm, deməli artıq göndərmisiniz. Mən bunu qeyd edirəm. Hansı nömrə ilə göndərmişdiniz?"

## Emotion And Style

The persona should be calm, not theatrical.

Support:

- patient
- short
- reassuring
- precise

Sales:

- polite
- consultative
- not pushy
- asks one question at a time

Complaint:

- apologetic
- concrete
- escalates quickly
- avoids defensiveness

CSAT:

- brief
- neutral
- does not argue with rating

## STT Benchmark Plan

Create a local Azerbaijani phone-audio test set.

Dataset:

- 50 short scripted phrases.
- 50 natural support phrases.
- 50 sales phrases.
- 30 noisy phone clips.
- 30 fast-speech clips.
- 30 mixed Azerbaijani/Russian/Turkish/English clips.
- product names, street names, numbers, dates, phone numbers.

Metrics:

- WER overall.
- WER for names and numbers.
- intent accuracy.
- latency to partial transcript.
- latency to final transcript.
- confidence calibration.
- robustness with phone codec.

Provider decision:

- Pick primary STT by accuracy for Azerbaijani phone audio.
- Pick fallback STT by availability and cost.
- Allow scenario-level override.

## TTS And Voice Clone Plan

For premium quality, hire or record a native Azerbaijani speaker.

Voice casting:

- one female and one male option;
- Baku-neutral speech;
- no Russian-heavy accent;
- warm but professional;
- clean studio recording;
- consistent pace.

Recording material:

- greetings;
- confirmations;
- apology phrases;
- number/date readings;
- ticketing scenarios;
- sales scenarios;
- edge cases and fallback phrases.

Evaluation:

- native listeners rate 1-5:
  - naturalness;
  - accent authenticity;
  - phone clarity;
  - trust;
  - emotional fit;
  - "would I continue the conversation?"

Keep a pre-recorded/cached phrase bank even when using live TTS. It improves latency and consistency for repeated high-value lines.

## Safety And Disclosure

Tenant policy decides exact disclosure, but system must support:

- "Mən LeadDrive/Fanum adından avtomatlaşdırılmış köməkçiyəm" when required.
- If customer asks "siz robotsunuz?", answer honestly.
- If customer asks for human, transfer or create task.
- If customer says "zəng etməyin", suppress future sales/marketing calls.

Do not build scripts that deny being AI.

## CRM Action Architecture

The voice agent never writes arbitrary data directly.

Flow:

1. Voice brain emits structured proposed action.
2. Action validator checks scenario allow-list, permissions, tenant, context, confidence.
3. Voice Core writes CRM update.
4. Audit event is stored.

Examples:

```json
{
  "action": "create_task",
  "confidence": 0.91,
  "payload": {
    "title": "Musteriye yeniden zeng",
    "dueAt": "2026-06-30T10:00:00+04:00",
    "assigneeStrategy": "ticket_owner"
  }
}
```

```json
{
  "action": "update_lead_qualification",
  "confidence": 0.88,
  "payload": {
    "interest": "pricing",
    "budget": "unknown",
    "timeline": "this_week",
    "decisionMaker": "self"
  }
}
```

## Multi-Tenant Risks

Tenant-specific risks:

- Tenant A voice clone accidentally used for Tenant B.
- Tenant A phrase bank leaks product terms into Tenant B.
- Shared provider fallback exposes wrong caller ID.
- Transcript/recording permissions leak.
- One tenant's high-volume campaign causes latency for another tenant.
- One tenant's bad prompt makes the global persona unsafe.

Controls:

- `VoicePersona` always scoped to `organizationId`.
- Voice ID belongs to one tenant unless explicitly marked platform-owned.
- Phrase bank scoped per tenant/persona/scenario.
- No global "default caller ID".
- Per-tenant queue capacity.
- Per-tenant AI provider budgets.
- Per-tenant recording retention.
- RBAC for persona editing and transcript access.

## High-Concurrency Risks

Risks:

- TTS provider rate limit.
- STT streaming session limit.
- LLM latency spikes.
- Media bridge CPU saturation.
- SIP provider channel exhaustion.
- Redis/queue backlog.
- Duplicate retries after provider outage.
- Cost spike from stuck sessions.

Controls:

- per-provider circuit breaker;
- per-provider capacity registry;
- weighted fair queue by tenant;
- separate queues for support and marketing;
- hard kill switch per tenant, provider, scenario;
- max call duration;
- max AI turns per call;
- stale session sweeper;
- cost meter before and during call;
- degrade from premium to fallback path only when policy allows it.

## Human Quality Gate

Do not launch this only by engineering tests.

Gate 1: Internal audio quality

- 20 generated calls reviewed by native speakers.
- Average naturalness >= 4.2/5.
- Accent authenticity >= 4.2/5.
- Number/date reading >= 95% correct.

Gate 2: Controlled live calls

- 30 calls to internal/test users.
- Complaint handling, sales qualification, CSAT.
- Track interruption success and confusion rate.

Gate 3: Small tenant beta

- one tenant;
- one scenario;
- one line;
- max 10 concurrent calls;
- daily review of transcripts and failed calls.

No production scale until gates pass.

## Recommended First Build

Start with a limited "Azerbaijani Ticket Callback Operator":

- Scenario: ticket clarification and callback scheduling.
- Provider: SIP/PSTN route from Voice Core.
- STT benchmark winner.
- TTS: benchmark ElevenLabs v3 Azerbaijani vs Azure Banu/Babek.
- LLM: scenario graph + structured action validator.
- CRM actions:
  - add ticket comment;
  - create callback task;
  - raise priority;
  - handoff to agent.

This is the smallest slice that proves voice quality, intelligence, CRM usefulness, and safety without launching broad marketing calls.

## Provider Selection Criteria

Choose providers by measured result, not marketing pages.

STT score:

- Azerbaijani phone WER.
- numbers/dates/names accuracy.
- partial latency.
- final latency.
- stability under noise.

TTS score:

- native accent rating.
- emotional naturalness.
- streaming latency.
- phone codec clarity.
- interruption behavior.
- cost per minute.

LLM score:

- follows scenario.
- does not hallucinate commitments.
- extracts facts correctly.
- handles anger and handoff.
- latency per turn.

Telephony score:

- caller ID correctness.
- answer rate.
- call setup latency.
- webhook reliability.
- SIP/media quality.
- channel capacity.

## Bottom Line

If budget is available, build this as a premium voice product, not a cheap bot:

- pay for native voice recording/clone;
- benchmark multiple Azerbaijani STT/TTS providers;
- keep scenario logic deterministic;
- let LLM handle language and extraction, not uncontrolled CRM writes;
- build multi-tenant isolation from the start;
- run human audio QA before scaling.

The winning system will be the one that combines a native-sounding Azerbaijani voice, low latency, controlled scenario intelligence, and reliable CRM execution.
