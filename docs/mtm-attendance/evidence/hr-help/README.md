# 5.8 — Attendance help for HR

The RU design mock was shown before implementation. The existing attendance report gains one native, initially collapsed disclosure. Eight short topics are translated in RU/AZ/EN. Existing report sections stay in place; authoritative access refusal also hides the help.

`actual/attendance-help-{ru,az,en}-{1440,390}.png` comes from the real React component with real translations, rendered by the focused jsdom tests and displayed with the application's compiled CSS in one Chromium. These are component previews, not an authenticated full-page E2E or production screenshots. No customer data is used. The orange outline demonstrates keyboard focus, not a permanent card border.

`capture-actual.cjs` reads `MTM_ATTENDANCE_RENDER_DIR` (default `/tmp/mtm-hr-help-render`) after the UI test and compiles only the classes found in those renders. It checks initial collapse, Enter/Space behavior, visible focus, eight topics, no horizontal overflow, no inner scrolling, and the summary target size. `actual/actual-capture-results.json` records metrics and SHA256 of each source HTML render. Summary targets are76–96px.

Validation:24 unique help/report UI tests PASS, lint4 files PASS, translation parity26153 keys PASS. A lint-only createElement adjustment was followed by3 help tests; fresh render hashes exactly match the captured images. Full build/semantic TypeScript are NOT RUN on Contabo and remain required CI gates. No schema/API/DB changes, mail sends or GPS collection.
