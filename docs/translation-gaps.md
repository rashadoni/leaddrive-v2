# Translation Gaps — Status

Last updated: 2026-05-25 (session 2)

## Previously documented gaps — ALL RESOLVED

### Nav keys (az.json)
All 5 previously missing nav keys now exist in az.json:
- `reportBuilder` → "Hesabat qurucusu"
- `landingPages` → "Landing səhifələr"
- `fieldPermissions` → "Sahə icazələri"
- `voip` → "VoIP"
- `financeNotifications` → "Maliyyə bildirişləri"

### Report Builder Page
`src/app/(dashboard)/reports/builder/page.tsx` — fully translated.
Uses `useTranslations("reportBuilder")`, 107 keys across en/ru/az. ✓

## 57-Ticket i18n Audit (docs/i18n-audit-tickets.md)
All Group A tickets (T-001 to T-006): raw keys → fully resolved.
All Group B pages now have `useTranslations`. All namespaces symmetric.

## Fixed 2026-05-25 in this session

### portal/chat/page.tsx (T-028 — partial)
Fixed 6 hardcoded strings → `t()` calls in portal namespace:
- `chatTitle` — "Da Vinci Dəstək" hardcoded → t("chatTitle")
- `chatError` — API error fallback text
- `chatNetworkError` — catch block error text
- `chatEscalated` — "Escalated to agent"
- `chatTicketPrefix` — "Ticket"
- `chatTyping` — "Typing..."

### portal/unsubscribe + portal/tickets/[id] (T-027)
8 + 7 = 15 strings translated (prior session commit 9b060288).

## Fixed 2026-05-25 session 2

### settings/channels/whatsapp/page.tsx — FULLY TRANSLATED ✓
Session 2 (first pass, 10 strings): subtitle, verify/verifying, save/saving, syncing/syncWithMeta, variables, saved/error, syncedCount, formatRelative, loading, noTemplates.
Session 3 (27 remaining strings, commits 4feb9f0a + 473cc9a2): credsTitle, credsDesc, credsConfigured, credsLastValidated, credsNotConfigured, editCreds, webhookTitle, webhookDesc (tw.rich() with <link> placeholder), autoNotifTitle, autoNotifDesc, autoNotifNoConfig, ticketStatusLabel, ticketStatusDesc, noSend ×3, surveyTemplateLabel, surveyTemplateDesc, journeyTemplateLabel, journeyTemplateDesc, noApprovedTemplates, templatesTitle ({count} ICU), templatesDesc, lastSync, createTemplatesHint, templateVarsLabel, templateButtonsLabel.

### settings/invoice-settings/page.tsx — FULLY TRANSLATED ✓
4 language-switching ternary chains → t() calls (commit 4feb9f0a):
emailTemplateGreeting, emailTemplateBody, emailTemplateClosing, emailTemplateNote.

## Remaining known gaps (lower priority)

### settings/web-to-lead (T-018)
Admin-only developer tool for generating embed code.
Internal labels ("Form Configuration", "Organization Slug", "API Endpoint", etc.)
are in English. Acceptable for an admin code-generation tool.

### leads/[id]/page.tsx — FULLY TRANSLATED ✓ (commits 074ea9e3 + 758122eb + 1a2c1031)
19 new keys for WhatsApp template panel + email topic select.
`|| "Russian fallback"` defensive pattern removed in 1a2c1031 (8 keys: modalTextType, modalTone, modalProfessional/Friendly/Formal/Persuasive, modalExtraInstructions, modalGenerating/GenerateText).
waSyncHint migrated to t.rich() with <link> placeholder so AZ word order is locale-controlled.

### invoices/[id]/page.tsx — RESOLVED ✓ (commit 074ea9e3)
1 string: title="Редактировать" → title={tc("edit")}
Note: lines 611-621 Cyrillic content is intentional (locale-keyed template defaults under `ru: {...}`).

### Long tail (T-031 to T-057)
Minor 1-4 string gaps in various pages. Non-blocking.
See docs/i18n-audit-tickets.md for full list.
