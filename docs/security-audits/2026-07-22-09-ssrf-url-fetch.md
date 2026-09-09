# Security audit 09 — SSRF / user-supplied URL fetch

Date: 2026-07-22

## Scope

Reviewed server-side outbound HTTP surfaces where a tenant/user-controlled URL can be stored or later called by the backend.

## Fixed

### P1 — AI delivery Slack webhook bypassed SSRF guard on write/test path

`src/lib/slack.ts` already validates Slack webhook URLs with `assertSafeWebhookUrl()` and sends with `redirect: "error"` + timeout. However:

- `PATCH /api/v1/settings/ai-delivery` stored `slackWebhookUrl` without validating it.
- `POST /api/v1/digest-subscriptions/test` called `fetch(d.slackWebhookUrl)` directly instead of using the guarded Slack sender.

Impact: an admin could save or test a crafted URL pointing at an internal, loopback, metadata, or non-Slack host. Even if regular cron delivery used the guarded sender, the test endpoint still had a direct SSRF path.

Mitigation:

- Validate `slackWebhookUrl` at settings write time with `assertSafeWebhookUrl(url, "slack")`.
- Route digest test Slack delivery through `sendSlackNotification()`, preserving the central SSRF guard, redirect rejection, and timeout.
- Added regression tests for unsafe URL rejection and guarded test delivery.

## Existing protections confirmed

- Slack and Teams senders reject unsafe/non-allowlisted webhook hosts.
- Slack and Teams senders use `redirect: "error"` to avoid allowlisted-host redirect SSRF.
- Generic outbound URL guard exists for non-provider-specific integrations.

## Residual risks / follow-up

- Telegram bot delivery is provider-fixed (`https://api.telegram.org/...`) and not a user-supplied host, but it should still use timeout/redirect policy for consistency.
- A broader outbound-fetch inventory should continue for non-webhook URL fields such as import connectors, discovery/scraping, file previews, image URLs, and future ERP/custom API integrations.

## Verification

- `vitest run src/__tests__/api-ai-delivery-ssrf.test.ts src/__tests__/lib-webhook-url-guard.test.ts src/__tests__/lib-webhook-sender-redirect.test.ts`
- `eslint src/app/api/v1/settings/ai-delivery/route.ts src/app/api/v1/digest-subscriptions/test/route.ts src/__tests__/api-ai-delivery-ssrf.test.ts`
- `git diff --check`
