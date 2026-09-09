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
