# Shared CRM appearance

All authenticated CRM pages use the approved palette and hierarchy: light gray workspace, white cards with visible boundaries, dark headings, muted descriptions, explicit status badges and orange primary actions. In dark mode the workspace is darker than its cards. These are the existing theme tokens, not an additional per-module palette.

## Scope and ownership

`CrmAppearanceProvider` covers the authenticated dashboard shell, including `/dashboard` and internal windows opened from navigation. The content column and each main area carry `data-crm-workspace`. The sidebar retains its navigation identity. Public pages do not opt into the workspace scope. The React context follows portals; Dialog, Popover, DropdownMenu and Sheet mark their own roots. `force-light` canvases retain light tokens even inside the dark theme. The owner explicitly extended the initial home exclusion to the whole CRM on 2026-10-25.

`src/app/crm-workspace.css` owns the scoped rules. It targets explicit component markers and named panel classes. Do not add selectors matching arbitrary color utility names or all gradients: status colors, maps, charts, brand logos and document/email contents carry independent meaning.

## Component rules

- `Card`, ordinary KPI panels, customer detail cards and `.crm-panel` use `bg-card` / `text-card-foreground` with the shared `--border`; recessed content uses `bg-muted`. The workspace border is `216 21% 84%` in light mode and `215 18% 33%` in dark mode; controls use the stronger `--input` boundary. Do not hardcode a pale zinc border in a shared component.
- `CrmSection` groups distinct record details, form sections and history using the same surface, spacing and heading. Its optional `tone` adds a semantic left edge; always include a textual status, never use the edge alone to communicate state. Avoid nesting sections into each other.
- `DataTable` uses the same white surface and visible frame, a recessed header and row separators. Sorting, filtering, keyboard behavior and pagination are unchanged.
- `StatCard` and `GradientKpiChip` use neutral surfaces within the workspace and keep their previous presentation outside it. `MotionCard` defaults to a bounded card inside the workspace; explicit `surface="none"` or `surface="inset"` supports layout-only or recessed elements. Its unconfigured behavior outside the workspace is unchanged. Explicit semantic color utilities remain available.
- Native inputs, selects and textareas use the same surface and stronger input boundary as shared controls. Their base-layer defaults allow explicit validation, transparent, disabled and focus utilities to win, including with wallpaper. Native checkboxes/radios use the brand accent.
- Default and legacy `brand` buttons share a darker orange action token for readable white text, with an 8 px radius. The brand/focus token stays orange. Secondary actions are outlined or quiet; `destructive-outline` is a reusable red border/text action. Existing destructive confirmations stay destructive.
- Shared tabs and local navigation with `data-crm-tabs` / `data-crm-tab` use dark active text and the orange underline. Local filter buttons use `data-crm-filter` with `data-state` for a neutral outlined selection. Keyboard focus indicators remain visible.
- `DidYouKnow` defaults to the compact disclosure inside the workspace, preserving text, links, paging and dismissal. Explicit variants remain compatible; the automatic choice is common to every CRM page.
- Ordinary metrics use dark numbers and muted labels/icons. Green, amber and red remain available for success, warnings and errors. Performance bars retain their threshold colors.
- Dialogs separate white headers/footers from the recessed content canvas. Simple sheets use a card surface; composite detail sheets request `surface="canvas"` to distinguish their white groups. Dropdowns and popovers inherit the workspace's button/badge rules.
- Home widgets use the same card and boundary tokens. A user-selected wallpaper remains a personalized canvas; it does not replace widget hierarchy with decorative gradients.

## Migrated local exceptions

Decorative panels, header gradients and special action palettes were removed from invoices, AI tools, social monitoring, contact segmentation, journeys, email analytics, event invitation UI, workflow/settings and channel-connection guidance. MTM agents use neutral role labels and hierarchy borders; presence, active/suspended states and team structure are unchanged. Transparent operational panels in contract lifecycle, VoIP insights and loyalty POS now explicitly use the card surface. Meeting details use shared sections for time/status, contacts, actions, follow-up, history and integration information; their order and permission checks are preserved. Meeting states map to information/confirmed, success/completed, destructive/cancelled and warning/no-show. Unknown states retain a neutral textual badge. Deal sheets and shared customer sections use the same grouping rules.

Legacy neutral borders and separators across internal pages and components use `border-border` / `divide-border`; ordinary field boundaries use `border-input`. This includes surrounding controls on maps, reports and channel settings. Custom Tasks/Projects/Products/Sequences navigation uses the shared tab/filter hooks. Custom Boards, Contracts and Tasks windows and ordinary HRM sections use the same bounded surfaces.

Category legends, workflow node types, chart series, channel logos, alerts, destructive actions and exported document/marketing designs remain semantic exceptions. The workspace rule must not flatten their meaning.

## Verification

Use the real native browser for visual verification. A small isolated fixture can check shared components with synthetic data before release; it does not establish production integration or authenticated backend behavior. Check light/dark surfaces, portal inheritance, keyboard tabs/help, status distinctions and a narrow viewport. After release verify the public artifact SHA and representative authenticated operational routes. Include home, a record detail sheet and a form in the representative sample. Do not claim every route was visually checked when only shared components or representative pages were inspected.
