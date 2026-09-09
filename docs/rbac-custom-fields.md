# RBAC for Custom Fields

> Scope: who can read / write / hide the `customFields` JSONB column on the
> `tasks` table (and the same pattern when extended to contact / deal / lead /
> company entities).

## TL;DR

- `Task.customFields` is a single Postgres **JSONB column** — not individual
  rows. The RBAC system operates at the **field level**, so the whole JSONB
  object is hidden or exposed as a unit. There is no per-key permission.
- **Default**: every role sees every custom field, can write every key.
  Server-side validation only enforces `isRequired` (per definition) and
  type/options correctness (per `fieldType`).
- To **hide** custom fields from a role: create a `FieldPermission` row
  with `entityType="task"`, `fieldName="customFields"`,
  `access="hidden"`, `roleId=<role>`. The API GET responses will strip the
  entire `customFields` object for that role.
- To **make read-only**: same pattern with `access="visible"` (default behavior)
  — the UI cells respect this via `isEditable()` from `useFieldPermissions`.
- This means **sensitive single fields cannot be hidden while keeping the
  rest visible**. Workaround: keep sensitive data on a dedicated entity
  (Deal / Contact) with its own field permissions, NOT inside a shared
  custom field on Task.

## How it works end-to-end

### Storage

(see `prisma/schema.prisma` — `Task.customFields` declaration)

```prisma
model Task {
  ...
  customFields Json? @default("{}")  // single JSONB column
}

model CustomField {
  organizationId String
  entityType     String   // "task" | "contact" | "deal" | "lead" | "company"
  fieldName      String   // slug key inside customFields (e.g. "outcome")
  fieldLabel     String   // human display
  fieldType      String   // "text" | "textarea" | "number" | "date" | "select" | "boolean"
  options        String[] // for select
  isRequired     Boolean
  defaultValue   String?
  isActive       Boolean
  @@unique([organizationId, entityType, fieldName])
}

model FieldPermission {
  organizationId String
  roleId         String   // "admin" | "manager" | "sales" | etc
  entityType     String
  fieldName      String   // e.g. "customFields" (entire JSONB) or "status", "title"
  access         String   // "visible" | "editable" | "hidden"
}
```

### Read path (GET responses)

1. API handler fetches Task with `select` (no explicit hide).
2. `getFieldPermissions(orgId, role, "task")` reads `FieldPermission` rows for
   that role+entity.
3. `filterEntityFields(task, permissions, role)` walks the entity object;
   for each key, if `permissions[key] === "hidden"` it drops the key.
   - Admin role always sees everything (early return).
   - No-permission-row → visible by default.
4. Result: if a `FieldPermission` row exists with
   `fieldName="customFields"` + `access="hidden"`, the field is removed
   from the response entirely for that role.

### Write path (POST / PATCH)

1. `filterWritableFields(body, permissions, role)` keeps ONLY fields whose
   permission is `editable` (or has no permission row at all — implicit
   default). Anything marked `visible` or `hidden` is silently stripped
   from the request body BEFORE the zod parse.
2. After parse, `validateRequiredCustomFields(orgId, "task", merged)` checks
   that every `isRequired=true` CustomField definition has a non-empty value
   in the final merged customFields object. Server returns 400 if not
   (Roadmap #9).
3. The merge then writes to DB.

### Bulk path (`POST /api/v1/tasks/bulk` with `action="update_custom_field"`)

- Always re-checks `prisma.customField.findFirst(orgId, "task", fieldName, isActive)`
  before writing — protects against arbitrary JSONB key injection.
- Validates `fieldValue` against `fieldType` (select against options,
  boolean is boolean, number is finite, text/date is string).
- Refuses to clear (`null` / `undefined` / `""`) any `isRequired=true` field.

## How to configure

### UI

`Settings → Field Permissions` (route: `/settings/field-permissions`)
1. Pick an entity (Task / Contact / Deal / etc) — top filter.
2. Find the row for the field. For custom fields under Task it appears as
   **"Custom Fields"** (label) / `customFields` (key) — a single row
   representing the whole JSONB.
3. For each role column, click Edit and choose `Visible` / `Editable` / `Hidden`.

> Note: `customFields` was added to the task field whitelist in
> `src/lib/entity-fields.ts` alongside this doc. Other entities
> (contact / deal / lead / company) currently expose only their built-in
> columns in this UI; if a tenant wants to RBAC-gate custom fields on those
> entities, add a matching entry to the corresponding array.

### Database (manual override)

```sql
-- Hide entire customFields object from the "viewer" role on tasks
INSERT INTO field_permissions ("organizationId", "roleId", "entityType", "fieldName", "access")
VALUES ('cmxxx...', 'viewer', 'task', 'customFields', 'hidden')
ON CONFLICT ("organizationId", "roleId", "entityType", "fieldName")
DO UPDATE SET access = EXCLUDED.access;
```

## Caveats

### 1. JSONB hides all or nothing

If you hide `customFields` for a role, **every key disappears** (outcome,
channel, sprint, etc). There is no way to expose 4 of 5 keys while hiding 1.

If you need per-key visibility, the recommended pattern is to extract the
sensitive key into a first-class column on the entity (e.g. add
`Task.sensitive_internal_note String?` to the schema) and gate that column
via a normal `FieldPermission` row.

### 2. Cache: permissions are cached 60 seconds

`getFieldPermissions` caches by `orgId:roleId:entityType` for 60 seconds
(`field-filter.ts`). A FieldPermission change takes up to a minute to
propagate to all in-flight requests. Acceptable for most cases; for a
hard kick-out scenario, restart the API pods (PM2 reload).

### 3. Workflows / API integrations bypass UI permission

A `Workflow` or `ApiKey` POSTing to `/api/v1/tasks` uses its own auth
(machine token), not a user role. Server-side `validateRequiredCustomFields`
and `update_custom_field` validation still fire, but field-level hide does
NOT apply. Don't put secrets in customFields if API consumers are not
trusted.

### 4. Inline editing UI is permission-aware

`useFieldPermissions("task")` hook returns `isEditable(fieldName)` which
the inline cells consult. When `access="visible"` (read-only), cells render
as static text. When `access="hidden"`, cells don't render at all. This
prevents accidental edits from non-admin roles even when the data did
reach the client (e.g. via a stale cache).

## See also

- `src/lib/field-filter.ts` — `getFieldPermissions`, `filterEntityFields`,
  `filterWritableFields` implementation
- `src/lib/custom-fields-validation.ts` — Roadmap #9 required-field server
  enforcement
- `src/app/api/v1/tasks/bulk/route.ts` — bulk endpoint with per-fieldType
  validation
- `src/app/(dashboard)/settings/field-permissions/page.tsx` — admin UI
- `src/hooks/use-field-permissions.ts` — client-side permission consumer
