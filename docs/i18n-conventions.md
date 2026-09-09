# i18n conventions

Project uses [next-intl](https://next-intl.dev). Catalogs live in
`messages/{en,ru,az}.json` and follow a namespace-per-page pattern
(`mtmActivity`, `mtmDashboardPage`, etc).

## ICU placeholders

When a translated string needs interpolation, name the variable for what
it carries. The intent: a translator reading just the English string
should be able to guess what fills the slot.

| Variable name | Use when carrying | Examples |
|---|---|---|
| `{n}` | A count / cardinal number | `"{n} selected"`, `"+{n} more"`, `"{n} min"`, `"{n} urgent"` |
| `{name}` | A person, customer, or org name (proper noun) | `"Welcome back, {name}!"`, `"visit to {name}"` |
| `{pct}` | A percentage value (already formatted with `%` outside) | `"{pct}% completion"` |

For other types — extend this table rather than invent ad-hoc names. The
goal is operator-readability; a translator landing on `{value}` has no
context whether it's a count, currency, or label, but `{amount}` /
`{currency}` / `{label}` would.

## Key naming

- **Camel case** within a namespace: `welcomeBack`, `kpiPlannedRoutes`.
- **Prefix-grouped** for parallel sets: `kpi*` for KPI labels, `lbl*` for
  setting labels, `col*` for table columns, `ach_*_label` for
  achievement-label pairs.
- **Nested objects** for enums or table-style data: `weekday.sun`,
  `period.today`, `fieldStatus.checkedIn`. Resolve at render-time via
  template literals: `t(\`weekday.${dayKeys[d]}\`)`.

## Drift guard

`src/__tests__/lib-i18n-keys.test.ts` walks every MTM page + component,
scrapes `t("…")` / `tX("…")` calls (including template literals with
`${…}` wildcards), and asserts:

1. Every literal key exists in `en.json` under the matching namespace.
2. The same set of keys exists in `ru.json` and `az.json` (parity).

The test fails loudly if a developer adds a `t("foo")` without also
adding `foo` to all three catalogs. Add to the suite when extending
i18n into a new directory:

```ts
const SCAN_GLOBS = [
  "src/app/(dashboard)/mtm",
  "src/components/mtm",
  // append new directories here
]
```

## Shared dictionaries

Sets that show up on multiple pages (e.g. agent field-status labels)
live in a single namespace and are reused. Don't copy keys across
namespaces — extract them and consume both sides.

Current shared:

- `mtmMap.fieldStatus.{checkedIn,onRoad,late,offline}` — agent status,
  used by `/mtm/map` page and `MtmLiveMap` component (live-map.tsx).
- `mtmForms.placeholder*` — form-input placeholders, used by MTM form
  components.

The runtime lookup for field-status is centralised in
`src/lib/mtm-types.ts:FIELD_STATUS_LABEL_KEYS` so both consumers go
through the same `STATUS → key` table.

## Adding a new page

1. Add the namespace block to all three catalogs (en/ru/az) before
   merging — `lib-i18n-keys.test.ts` will fail on missing translations.
2. Pull the translator with `const t = useTranslations("yourNamespace")`.
3. Replace every JSX literal / `placeholder=` / `title=` / toast
   message with a `t()` call.
4. Run `npx vitest run src/__tests__/lib-i18n-keys.test.ts` locally
   before pushing. The CI gate runs it on every deploy.
