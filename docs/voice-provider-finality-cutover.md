# Asterisk durable-attempt cutover

This runbook covers the production activation boundary for the pinned-TLS,
HMAC-authenticated PBX attempt registry. Source deployment alone must leave all
execution gates off. It does not authorize a call, a PBX change, or a rollout.

## Gates

- `voiceAttemptRegistryEnabled=true` on the one pilot Asterisk
  `ChannelConfig` opts that PBX into pinned HTTPS for every control request.
  The VoIP settings UI does not expose this technical field. The config API
  rejects it outside `VOICE_AGENT_ORGANIZATION_ID` and clears a stale value if
  the pilot changes.
- `VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED=true` selects durable PUT/GET/cancel
  semantics only when the per-config capability is also true.
- `VOICE_PROVIDER_FINALITY_RECONCILIATION_ENABLED=true` separately allows the
  cron to settle `dispatch_uncertain` rows. It never originates or retries a
  call. `accepted`, `active`, unknown, malformed, unsigned and transport-error
  results retain every fence.

All three controls are off by default. The CRM and PBX secret stores must hold
the same exact raw runtime token; surrounding whitespace is invalid. Do not
print the token while comparing configuration.

## Prestage without execution

1. Deploy the CRM code with both environment flags false and the pilot config
   capability absent/false.
2. Install only the reviewed public CA in CRM. Keep every private CA/server key
   on the PBX host.
3. Prepare the PBX registry, loopback Asterisk listener, TLS proxy, firewall,
   terminal emitter and dialplan authorization gate using the reviewed,
   hash-gated installer. Do not resume dispatch yet.
4. Verify live hashes, TLS certificate name/chain, loopback ownership, source
   restriction, signed response format and service health without placing a
   call. A generic 404 is never finality proof.

## Atomic activation window

1. Run the CRM pause and PBX deployment in one serialized production workflow;
   a standalone pause is maintenance preparation, not authorization to mutate
   the PBX. Keep the same `production-deploy` exclusion held until PBX
   postconditions are complete.
2. Immediately before PBX quiesce and again after drain, call the maintenance
   attestation with a distinct random 256-bit lowercase-hex challenge and the
   exact reviewed CRM deployment SHA. Trust only a signed response that echoes
   both values, was issued inside its 30-second validity window, proves process
   and durable dispatch pause, proves registry disabled, and reports zero open
   sessions/calls and `callsPlaced=0`.
3. Activate the PBX TLS listener, registry and dialplan gate in the same change
   window in which the pilot config capability and
   `VOICE_PROVIDER_ATTEMPT_REGISTRY_ENABLED` become true. Do not resume between
   these steps: the PBX gate requires a durable row for both call modes.
4. Prove that the CRM reaches the authenticated ARI identity over pinned HTTPS
   and that an HMAC-signed registry read returns a signed typed response. An
   absent UUID must remain `unknown`; it must not release a fence.
5. Resume dispatch only after both sides show the intended live configuration.
6. Keep automatic finality reconciliation false for the first observation
   period. Enable it later as a separate change only after terminal evidence,
   callback consistency and fence retention have been reviewed.

## Fail-closed rollback

Pause dispatch first. Never roll back only the global registry flag and then
resume: an opted-in config deliberately stays on pinned HTTPS, while legacy
originate semantics do not satisfy the PBX durable-row gate. Roll the PBX gate,
the pilot capability and the global flag as one reviewed bundle, preserving
all uncertain fences. Do not auto-redial an attempt whose delivery is unknown.
