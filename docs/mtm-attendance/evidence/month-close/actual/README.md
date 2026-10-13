# Closed month — actual component evidence

Six images render the actual `MtmAttendanceMonths` React component with fictional fixture data in Russian, Azerbaijani and English at1440/390px. They are not production screenshots, full browser E2E results or physical-phone tests. Closed cells, download controls and the safe correction journal are visible; a request reason is accessed only through its existing scoped request link.

`mtm-attendance-month-ui.test.ts` emits the HTML when `MTM_ATTENDANCE_RENDER_DIR` is set. `../capture-actual.cjs` compiles only the rendered utility classes against the repository stylesheet and captures one sequential Chromium session. `capture-results.json` records viewport fit, no nested horizontal scrolling and minimum44px action targets. RU1440/AZ390 were visually inspected after the Card correction.

The actual fixture deliberately shows a completed closed snapshot and its later correction separately. Original175:50 stays in the saved month. Current accounting changes through the approved request ledger; the fixture does not claim real employee hours.
