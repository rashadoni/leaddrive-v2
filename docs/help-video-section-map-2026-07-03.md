# Help Video Section Map - 2026-07-03

Purpose: confirmation map before writing and rendering the remaining help-video scripts. This map intentionally combines the current help-video registry with the main navigation source of truth so nav-only sections are not forgotten.

Sources: `src/content/help/video-assets.ts`, `src/lib/nav-items.ts`, `video/player/*`.

## Summary

- Registered help-video entries: 100.
- Main navigation entries scanned: 145.
- Combined section map: 125.
- Approved complete video sets now: 3.
- Nav-only sections needing confirmation/registry entry: 25.

## Scenario Standard

- Minimum narration target per section: 2 minutes per locale (`ru`, `en`, `az`).
- Scenario shape: open route, identify what the section is for, complete one realistic task, show risky/permission-sensitive areas, show where to verify the result, finish with a recap.
- Video shape: real browser-guided capture, cursor movement, click/hover feedback, localized narration, approved external/studio audio only, no local TTS.
- Before production render: each section needs stable `data-tour-id` / `data-video-target` selectors on the real UI.

## Confirmation Map

### CRM (8)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 1 | `boards` | `/boards` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 2 | `companies` | `/companies` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 3 | `contacts` | `/contacts`<br>`/contacts/list` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 4 | `dashboard` | `/dashboard` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 5 | `notifications` | `/notifications` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 6 | `products` | `/products` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 7 | `projects` | `/projects` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 8 | `task-templates` | `/settings/task-templates` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |

### Sales (14)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 9 | `deals` | `/deals` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 10 | `forecast` | `/forecast` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 11 | `forecast-snapshots` | `/forecast/snapshots` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 12 | `forecast-velocity` | `/forecast/velocity` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 13 | `forecast-waterfall` | `/forecast/waterfall` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 14 | `lead-rules` | `/settings/lead-rules` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 15 | `leads` | `/leads` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 16 | `pipelines` | `/settings/pipelines` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 17 | `quotas` | `/settings/quotas` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 18 | `quotes` | `/quotes` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 19 | `sales-forecast-settings` | `/settings/sales-forecast` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 20 | `sequences` | `/sequences` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 21 | `territories` | `/settings/territories` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 22 | `web-to-lead` | `/settings/web-to-lead` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |

### Contracts Control (8)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 23 | `approval-delegates-nav` | `/settings/approval-delegates` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 24 | `approval-rules-nav` | `/settings/approval-rules` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 25 | `contract-analytics` | `/contracts/analytics` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 26 | `contract-lifecycle` | `/contracts/lifecycle` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 27 | `contract-request` | `/contracts/request` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 28 | `contract-templates` | `/contracts/templates` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 29 | `contracts` | `/contracts` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 30 | `intake-forms` | `/settings/intake-forms` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |

### Communication (7)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 31 | `channels` | `/settings/channels/connect`<br>`/settings/channels` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 32 | `inbox` | `/inbox` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 33 | `inbox-automation` | `/inbox/automation` | registry+nav | registered | approved-complete | done, >=2m target for future revisions |  |
| 34 | `snippets` | `/settings/snippets` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 35 | `social-monitoring` | `/social-monitoring` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 36 | `web-chat-nav` | `/settings/web-chat` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 37 | `whatsapp-business-calls` | `/settings/channels/connect/whatsapp-business-calls` | registry+nav | registered | approved-complete | done, >=2m target for future revisions |  |

### Support (13)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 38 | `agent-calendar` | `/support/calendar` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 39 | `agent-desktop` | `/support/agent-desktop` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 40 | `complaints` | `/complaints` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 41 | `entitlements` | `/support/entitlements` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 42 | `escalation` | `/settings/escalation` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 43 | `knowledge-base` | `/knowledge-base` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 44 | `portal-users` | `/settings/portal-users` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 45 | `settings-voip` | `/settings/voip` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 46 | `skill-routing` | `/support/skill-routing` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 47 | `sla-policies` | `/settings/sla-policies` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 48 | `tickets` | `/tickets` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 49 | `voip` | `/support/voip` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 50 | `voip-insights` | `/voip/insights` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |

### Marketing (14)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 51 | `account-engagement` | `/accounts/engagement` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 52 | `ai-scoring` | `/ai-scoring` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 53 | `attribution-models` | `/attribution/models` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 54 | `campaign-roi` | `/campaign-roi` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 55 | `campaigns` | `/campaigns` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 56 | `cdp-insights` | `/cdp/insights` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 57 | `cdp-merge-queue` | `/cdp/merge-queue` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 58 | `email-log` | `/email-log` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 59 | `email-templates` | `/email-templates` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 60 | `events` | `/events` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 61 | `journeys` | `/journeys` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 62 | `landing-pages` | `/pages` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 63 | `segments` | `/segments` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 64 | `surveys` | `/surveys` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |

### Loyalty Program (6)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 65 | `loyalty-builder` | `/loyalty/builder` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 66 | `loyalty-dashboard` | `/loyalty/dashboard` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 67 | `loyalty-earn-rules` | `/loyalty/earn-rules` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 68 | `loyalty-pos` | `/loyalty/pos` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 69 | `loyalty-promo-codes` | `/loyalty/promo-codes` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 70 | `loyalty-tiers` | `/loyalty/tiers` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |

### Finance (9)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 71 | `budget-config` | `/settings/budget-config` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 72 | `budgeting` | `/budgeting` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 73 | `finance` | `/finance` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 74 | `finance-notifications` | `/settings/finance-notifications` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 75 | `invoice-settings` | `/settings/invoice-settings` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 76 | `invoices` | `/invoices` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 77 | `pricing` | `/pricing` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 78 | `profitability` | `/profitability` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 79 | `subscriptions` | `/billing/subscriptions` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |

### Analytics (5)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 80 | `ai-actions` | `/ai/actions` | registry+nav | registered | approved-complete | done, >=2m target for future revisions |  |
| 81 | `ai-command-center` | `/ai-command-center` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 82 | `kpi-arena` | `/leaderboard` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 83 | `report-builder` | `/reports/builder` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 84 | `reports` | `/reports` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |

### Route & Field (14)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 85 | `mtm-activity` | `/mtm/activity` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 86 | `mtm-agents` | `/mtm/agents` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 87 | `mtm-alerts` | `/mtm/alerts` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 88 | `mtm-analytics` | `/mtm/analytics` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 90 | `mtm-customers` | `/mtm/customers` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 93 | `mtm-leaderboard` | `/mtm/leaderboard` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 94 | `mtm-map` | `/mtm/map` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 96 | `mtm-overview` | `/mtm` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 97 | `mtm-photos` | `/mtm/photos` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 101 | `mtm-reports` | `/mtm/reports` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 102 | `mtm-routes` | `/mtm/routes` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 103 | `mtm-settings` | `/mtm/settings` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 106 | `mtm-tasks` | `/mtm/tasks` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |
| 107 | `mtm-visits` | `/mtm/visits` | registry+nav | registered | missing 6/6 | todo: write >=2m script |  |

### Settings (13)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 108 | `ai-automation` | `/settings/ai-automation` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 109 | `api-keys` | `/settings/api-keys` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 110 | `dashboard-settings` | `/settings/dashboard` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 111 | `field-permissions` | `/settings/field-permissions` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 112 | `integrations` | `/settings/integrations` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 113 | `kpi-arena-config` | `/settings/leaderboard` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 114 | `macros` | `/settings/macros` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 115 | `marketplace` | `/marketplace` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 116 | `pitch-links` | `/settings/pitch-links` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 117 | `settings` | `/settings` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 118 | `smtp` | `/settings/smtp-settings` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 119 | `users` | `/settings/users` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 120 | `workflows` | `/settings/workflows` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |

### Health Cloud (4)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 121 | `health-patients` | `/health` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 126 | `health-encounters` | `/health/encounters` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 127 | `health-care-plans` | `/health/care-plans` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 128 | `health-providers` | `/health/providers` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |

### Insurance Cloud (4)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 122 | `insurance-policyholders` | `/insurance` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 129 | `insurance-policies` | `/insurance/policies` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 130 | `insurance-claims` | `/insurance/claims` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 131 | `insurance-beneficiaries` | `/insurance/beneficiaries` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |

### Public Sector (4)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 123 | `public-sector-citizens` | `/public-sector` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 132 | `public-sector-cases` | `/public-sector/cases` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 133 | `public-sector-licenses` | `/public-sector/licenses` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 134 | `public-sector-grants` | `/public-sector/grants` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |

### Media Cloud (3)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 124 | `media-subscribers` | `/media` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 135 | `media-content` | `/media/content` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 136 | `media-ad-campaigns` | `/media/ad-campaigns` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |

### Energy & Utilities (4)

| # | Slug | Routes | Source | Registry | Assets | Scenario | Notes |
|---:|---|---|---|---|---|---|---|
| 125 | `energy-customers` | `/energy` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 137 | `energy-metering` | `/energy/metering` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 138 | `energy-outages` | `/energy/outages` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
| 139 | `energy-service-calls` | `/energy/service-calls` | nav-only | needs registry entry | missing 6/6 | todo: write >=2m script | add to help-video registry if confirmed |
