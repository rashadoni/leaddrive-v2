#!/usr/bin/env bash
set -Eeuo pipefail
export NEXTAUTH_SECRET=leaddrive-ci-build-only-not-a-runtime-secret-8b7d4e7fb4da99da31d73e3c3e0c02a8
# Run security gates
npm run lint:pii-columns
python3 scripts/rls/find-context-gaps.py
npm test -- --run \
  src/__tests__/lib-tenant-pii-encryption.test.ts \
  src/__tests__/lib-secure-token.test.ts \
  src/__tests__/ai-pii-masker.test.ts \
  src/__tests__/ai-prompt-safety.test.ts \
  src/__tests__/no-bare-anthropic-constructor.test.ts \
  src/__tests__/api-build-info.test.ts \
  src/__tests__/lib-event-platform-catalog.test.ts \
  src/__tests__/lib-event-platform-foundation.test.ts \
  src/__tests__/api-finance-funds.test.ts \
  src/__tests__/workforce-retention-guard.test.ts

# Run MTM + auth + i18n tests
npm test -- --run src/__tests__/api-mtm src/__tests__/lib-auth src/__tests__/lib-tenant-domain src/__tests__/lib-i18n
# Run Gemini-only browser voice regression gate
npm test -- --run \
  src/__tests__/gemini-live-voice.test.ts \
  src/__tests__/gemini-live-browser.test.ts \
  src/__tests__/gemini-live-worklets.test.ts \
  src/__tests__/api-ai-voice-token-lifecycle.test.ts \
  src/__tests__/api-ai-voice-connected-lifecycle.test.ts \
  src/__tests__/api-ai-voice-session-start.test.ts \
  src/__tests__/api-ai-voice-session-end.test.ts \
  src/__tests__/api-ai-voice-session-reaper.test.ts \
  src/__tests__/api-ai-voice-read-access.test.ts \
  src/__tests__/api-ai-voice-trace-privacy.test.ts \
  src/__tests__/voice-console-gemini-ui.test.ts \
  src/__tests__/voice-gate-budget.test.ts \
  src/__tests__/voice-gemini-provider-fence.test.ts \
  src/__tests__/csp.test.ts
