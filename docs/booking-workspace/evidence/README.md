# Booking workspace browser evidence — 2026-10-24

These images use **synthetic fixtures**, not customer or production data.
The real `BookingWorkspace` and its panels were mounted in an isolated Vite
harness with React Query, next-intl and the repository's stylesheet. Only
Next navigation/session adapters and API responses were substituted.

The sequential Playwright run covered 1440×1000 and 390×844 viewports,
light/dark theme, list/calendar/detail, manual creation, move, cancellation,
outcome, ordinary follow-up task, booking-page tab, coordinator grant,
keyboard focus containment/Escape and recovery after a context API error.
No document/dialog horizontal overflow or browser JavaScript/console errors
remained in the final run. `browser-result.json` records the exercised mutations.

This is component-level UI evidence. It does not prove authentication,
PostgreSQL constraints, real provider delivery, production deployment or a
full application browser journey; those require their separate gates.

The scratch harness lives under the ignored task-owned
`.tmp-vitest/booking-preview` directory on the editing host. It uses mocked
`/api/v1/*` responses and binds only `127.0.0.1:4178`; it was stopped after
verification. No provider sends were performed.
