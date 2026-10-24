# Booking workspace browser evidence — 2026-10-24

These images use **synthetic fixtures**, not customer or production data.
The real `BookingWorkspace` and its panels were mounted in an isolated Vite
harness with React Query, next-intl and the repository's stylesheet. Only
Next navigation/session adapters and API responses were substituted.

The sequential Playwright run covered 1440×1000 and 390×844 viewports,
light/dark theme, list/calendar/detail, manual creation, move, cancellation,
outcome, ordinary follow-up task, booking-page tab, coordinator grant,
history cache isolation across user/privacy changes, keyboard focus containment/Escape and recovery after a context API error.
No document/dialog horizontal overflow or browser JavaScript/console errors
remained in the final run. `browser-result.json` records the exercised mutations.

This is component-level UI evidence. It does not prove authentication,
PostgreSQL constraints, real provider delivery, production deployment or a
full application browser journey; those require their separate gates.

The scratch harness lives under the ignored task-owned
`.tmp-vitest/booking-preview` directory on the editing host. It uses mocked
`/api/v1/*` responses and binds only `127.0.0.1:4178`; it was stopped after
verification. No provider sends were performed.

## Menu discovery follow-up

`menu-search-browser-result.json` and `menu-search-{desktop,mobile}.png`
exercise the real AppLauncher and LauncherPrefsProvider in a second isolated
Vite harness. The workspace phase and Russian messages are real; only Next
navigation and the local preferences API are adapted. Both old/new booking
names, exactly one destination, Enter navigation to `/meetings`, parent/keyboard
reopening with an empty search, 1440px/390px layout, no browser errors and no
external requests are checked. The preview process was stopped afterwards.
This is component evidence, not an authenticated production booking journey.
Sidebar and command-search share the same translated matcher; their permissions
and three-language discovery are covered by targeted unit checks.
