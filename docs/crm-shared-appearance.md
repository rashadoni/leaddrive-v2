# Shared CRM appearance

Operational pages use the approved CRM palette: light gray workspace, white cards, dark headings, muted descriptions and orange primary actions. In dark mode the workspace is darker than its cards. These are the existing theme tokens, not an additional per-module palette.

## Scope and ownership

`CrmAppearanceProvider` and `data-crm-workspace` are applied by the dashboard layout to the working main area. `/dashboard` is deliberately excluded. Sidebar, top navigation and public pages retain their existing appearance. The React context follows workspace-owned portals; Popover, DropdownMenu and Sheet mark their portal roots accordingly. `force-light` canvases keep their own inherited light tokens.

`src/app/crm-workspace.css` owns the scoped rules. It targets explicit component markers and named panel classes. Do not add selectors matching arbitrary color utility names or all gradients: status colors, maps, charts, brand logos and document/email contents carry independent meaning.

## Component rules

- `Card`, ordinary KPI panels and `.crm-panel` use `bg-card` / `text-card-foreground`; recessed content uses `bg-muted`.
- `StatCard` and `GradientKpiChip` use neutral surfaces within the workspace and keep their previous presentation outside it. `MotionCard` accepts an explicit `surface` for working panels; its unconfigured behavior is unchanged.
- Default buttons use the existing primary orange. The legacy `brand` button follows that same color inside the workspace. Secondary actions are outlined or quiet.
- Shared tabs use dark active text and the orange underline. Keyboard focus indicators remain visible.
- `DidYouKnow` defaults to the compact disclosure inside the workspace, preserving text, links, paging and dismissal. Explicit variants and the homepage remain compatible.
- Ordinary metrics use dark numbers and muted labels/icons. Green, amber and red remain available for success, warnings and errors. Performance bars retain their threshold colors.
- Dialogs and sheets are raised card surfaces. Dropdowns and popovers retain their readable popup surface and inherit the workspace's button/badge rules.

## Migrated local exceptions

Decorative panels, header gradients and special action palettes were removed from invoices, AI tools, social monitoring, contact segmentation, journeys, email analytics, event invitation UI, workflow/settings and channel-connection guidance. MTM agents use neutral role labels and hierarchy borders; presence, active/suspended states and team structure are unchanged. Transparent operational panels in contract lifecycle, VoIP insights and loyalty POS now explicitly use the card surface.

Category legends, workflow node types, chart series, channel logos, alerts, destructive actions and exported document/marketing designs remain semantic exceptions. The workspace rule must not flatten their meaning.

## Verification

Use the real native browser for visual verification. A small isolated fixture can check shared components with synthetic data before release; it does not establish production integration or authenticated backend behavior. Check light/dark surfaces, portal inheritance, keyboard tabs/help, status distinctions and a narrow viewport. After release verify the public artifact SHA and representative authenticated operational routes. Do not visit the excluded homepage to perform this task.
