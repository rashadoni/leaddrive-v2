# Workflow Templates

Pre-built automation templates that users can apply in one click instead of
building workflows from scratch. Ships as part of Phase 1 of the TT gap closure.

## What the user sees

1. Navigate to **Settings → Workflows**.
2. Click **"Browse templates"** (Sparkles icon) in the top-right, or use the
   sidebar link **"Workflow Templates"** under the Settings group.
3. Pick a template card and click **"Use template"**. A new `WorkflowRule`
   (plus actions) is created in the current org and the user is redirected back
   to the workflows list.

Templates are grouped by category: **Sales · Support · Marketing · Operations**.
Each card shows the trigger (`entityType.triggerEvent`) and the number of
actions that will be created.

## Current catalog (7 templates)

| ID | Category | Trigger | Actions |
|---|---|---|---|
| `welcome-new-lead` | sales | `lead.created` | send_email |
| `auto-assign-lead` | sales | `lead.created` | auto_assign + send_notification |
| `deal-won-thank-you` | sales | `deal.updated (status=won)` | send_email + create_task |
| `new-ticket-acknowledge` | support | `ticket.created` | send_email |
| `high-priority-alert` | support | `ticket.updated (priority=high)` | send_notification + slack_notify |
| `deal-stuck-followup` | sales | `deal.updated (stage=negotiation)` | create_task |
| `missed-call-sms` | operations | `call.missed` | send_sms + create_task |

## Code map

| Piece | Path |
|---|---|
| Catalog | `src/lib/workflow-templates.ts` |
| API | `src/app/api/v1/workflows/templates/route.ts` |
| UI | `src/app/(dashboard)/settings/workflows/templates/page.tsx` |
| Sidebar link | `src/components/sidebar.tsx` (`workflowTemplates` key) |
| Translations | `messages/{en,ru,az}.json` — namespace `workflowTemplates` |
| Tests | `src/__tests__/lib-workflow-templates.test.ts` |

## Adding a new template

1. Append an entry to `WORKFLOW_TEMPLATES` in `src/lib/workflow-templates.ts`.
2. Choose `actionType` values that workflow-engine actually handles — see the
   `SUPPORTED_ACTIONS` set in `lib-workflow-templates.test.ts` for the current
   whitelist.
3. Add i18n keys under `workflowTemplates.items.<id>.name` and
   `workflowTemplates.items.<id>.description` in **all three** messages files.
4. Register the icon name in `ICONS` in the templates page. Import from
   `lucide-react`.
5. Run `npm run i18n:check` — should report `missing=0`.
6. Run `npx vitest run src/__tests__/lib-workflow-templates.test.ts` — the
   parity/shape tests will catch malformed entries.

## API

### GET `/api/v1/workflows/templates`

Returns the full catalog. Client resolves names/descriptions via the
`workflowTemplates` i18n namespace.

### POST `/api/v1/workflows/templates`

Body:
```json
{ "templateId": "welcome-new-lead", "name": "My welcome flow", "isActive": true }
```

Creates a `WorkflowRule` + `WorkflowAction[]` scoped to the caller's org.
Returns the created rule with its actions.

## Conventions

- **IDs are stable** — used both as entity keys in the DB-created rule name and
  as i18n key segments. Renaming an ID is a breaking change for existing UI
  references.
- **Condition format** matches what workflow-engine evaluates:
  `{ rules: [{ field, operator, value }] }` with operators `equals`,
  `not_equals`, `contains`, `not_empty`, `greater_than`, `less_than`.
- **Action configs** are passed through to the action executor as-is. For
  `send_email`/`send_sms`, you can use `{{field}}` placeholders that
  workflow-engine substitutes from the trigger entity.

## Known limitations

- `entityType: "call"` is novel — workflow-engine does not register "call" in
  `SAFE_UPDATE_FIELDS`. `update_field` actions against call entities will be
  blocked by the safety whitelist. Not an issue for `missed-call-sms` which
  only uses `send_sms` + `create_task`.
- There is no "remove template" UI yet. Users delete via the normal Workflows
  list after applying.
