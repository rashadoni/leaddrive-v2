# MTM Routes R3 — candidate pagination checkpoint

## Additive API contract

Existing callers keep their current bounded response:

```text
GET /api/v1/mtm/routes/candidates?...
```

The canonical day planner may opt in to keyset pagination:

```text
GET /api/v1/mtm/routes/candidates?...&pagination=keyset&limit=50
GET /api/v1/mtm/routes/candidates?...&pagination=keyset&limit=50&cursor=<opaque>
```

`limit` is bounded to 1–100. The opt-in response adds `data.pagination` with
`schemaVersion`, `mode`, `supported`, `sortIntegrity`, `limit`, `hasMore`, and
`nextCursor`; legacy responses do not gain that field.

## Safety properties

- Only `NAME` and `PRIORITY` use keyset pagination. Their order is the same
  database tuple order used by the cursor: `(name, id)` or `(category, name,
  id)`.
- Cursor payloads are encrypted/authenticated, versioned, short-lived, and
  bound to tenant, user, web/mobile principal, resolved route scope, and the
  normalized candidate query. A stale, tampered, or scope-mismatched cursor
  fails closed before candidates are queried.
- The cursor uses tuple predicates rather than a Prisma row cursor, so losing
  the previous row does not make a valid later page fail.
- Keyset doctor pages require an eligible active workplace in the query itself;
  page metadata therefore describes routable targets rather than contacts that
  are later discarded during projection.
- Tenant capability, RLS, actor resolution, and selected-agent scope run before
  any cursor is accepted. Route creation/update checks remain unchanged.

## Explicit current limit

`LAST_VISIT` and `COVERAGE_GAP` are currently sorted only after the legacy
500-row fetch. When an opt-in request uses either sort, the API returns
`pagination.mode = LEGACY_CAP` and `sortIntegrity = PARTIAL`, never a false
next cursor. A globally ordered implementation needs separate, measured query
and coverage-snapshot work before it can be enabled.

Facet values are still derived from the returned page; they are not claimed to
be a complete tenant-wide facet index. No schema or migration is part of this
checkpoint.

## Planner behavior

The existing day planner opts into the new contract with 50-record pages. It
keeps selected route stops in the draft while a user changes pages, resets the
cursor only when the planning query changes, and provides native previous/next
buttons, live page status, and a retry action. The old matrix remains on its
legacy bounded request; its additive handoff opens the canonical day planner.
