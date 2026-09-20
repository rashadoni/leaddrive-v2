# Public legal links — session log

## 2026-09-20 — requirements and initial state

- Add public links to the CRM privacy policy, terms of use and data-deletion
  instructions in both the main marketing footer and the CRM login screen.
- All three destinations must remain available without authentication and use
  `/legal/privacy`, `/legal/terms` and `/legal/data-deletion`.
- Labels and destinations must preserve English, Russian and Azerbaijani.
- Initial inspection found all three routes in the marketing footer, but the
  privacy label was generic and the links did not carry an explicit language.
  The login screen exposed only privacy and terms.
- Work is isolated on `codex/legal-links-footer` from production `main`
  (`679a2a7381b13e6b15b30bc8b18a34861007d4de`).

## 2026-09-20 — implementation and verification

- The marketing footer now labels the privacy destination explicitly as the
  CRM policy and adds the resolved EN/RU/AZ locale to all three `/legal/*`
  destinations.
- The CRM login screen now exposes privacy, terms and data deletion together,
  uses the same localized labels and includes the resolved locale in every
  destination. Its compact legal navigation wraps on narrow screens.
- Added `public-legal-links.test.ts` to enforce all nine localized labels, all
  six entry-point routes and the absence of the obsolete `/privacy` target.
- Verification passed: `git diff --check`; targeted Vitest suite (2 files,
  108 tests); `npm run i18n:check` (23,175 keys, no missing/extra RU or AZ
  keys); targeted ESLint (zero errors, one pre-existing unused `socialLinks`
  warning in the marketing footer).
- Full build and browser verification were not run on Contabo; the repository
  contract assigns the production build to GitHub CI. Nothing has been pushed,
  merged or deployed in this phase.

## 2026-09-20 — GitHub release in progress

- Branch `codex/legal-links-footer` was pushed and PR 255 passed scope,
  runner-policy, secret-scan, static and typecheck gates.
- PR 255 was squash-merged to `main` as
  `778a55feb5365f6a3dd447fb5b629975f26399c1`.
- Production workflow 35508393131 is still in progress. Quality/security gates
  completed successfully; the last observed active step was `Build Next.js
  standalone` in `Production build & publish artifact`.
- Resume by waiting for workflow 35508393131. If successful, smoke
  `/api/v1/ping`, the marketing home footer and the tenant/app login legal
  links in EN/RU/AZ. Confirm privacy targets `/legal/privacy?lang=...`, never
  `/privacy`.
