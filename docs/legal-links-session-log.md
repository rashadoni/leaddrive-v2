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

## 2026-09-20 — released and verified on production

- PR 255 was squash-merged to `main` as
  `778a55feb5365f6a3dd447fb5b629975f26399c1`, and deploy workflow 35508393131
  finished `success`. Every post-deploy step ran — none skipped — including the
  atomic deploy, the seven scheduler verifiers, tenant-isolation coverage, the
  revision check and the login-page feature smoke.
- `/api/v1/ping` returns `{"ok":true}` (HTTP 200).
- The CRM login screen serves all three localized links, with no `/privacy`
  anywhere in the markup:
  - `en` — CRM Privacy Policy, Terms of Use, Data Deletion
  - `ru` — Политика конфиденциальности CRM, Условия использования, Удаление данных
  - `az` — CRM Məxfilik Siyasəti, İstifadə Şərtləri, Məlumat Silinməsi
- All six destinations answer HTTP 200 and the body follows `lang`:
  `/legal/{privacy,terms,data-deletion}?lang={en,ru,az}`. The `<h1>` switches
  per locale (Privacy Policy / Политика конфиденциальности / Məxfilik Siyasəti);
  only the `<title>` tag stays English, which this change did not touch.
- The locale comes from the `NEXT_LOCALE` cookie via `x-locale` in
  `src/proxy.ts`, not from `Accept-Language`. A probe without that cookie gets
  `defaultLocale` (`ru`) and looks like the locale is stuck — it is not.

### Open point: the public marketing footer is served by another repository

- `src/components/marketing/footer.tsx` was changed by this release, but
  production no longer serves it. `app.leaddrivecrm.org/home`, `/about`,
  `/plans` and `/contact` all answer `307` to `leaddrivecrm.org`, which is the
  separate Cloudflare Worker built from `rashadoni/leaddrive-site`. The edited
  footer is effectively dead code on production.
- The live footer at `leaddrivecrm.org` still links `/privacy`, `/terms`,
  `/terms-of-use` and `/privacy/field-app`. It carries no `/legal/*?lang=`
  target and no data-deletion link, and the markup is byte-identical across
  locales because that site is static.
- That site's `/privacy` is **not** a stale copy of the CRM policy: it is a
  distinct 14-section operator policy in Azerbaijani, with its own language
  switcher, covering state registration and the supervisory authority. So
  "never link the old `/privacy`" is satisfied inside the CRM, while on the
  marketing site the same link points at a real and current document.
- Whether the marketing footer should additionally expose the three CRM legal
  documents is a product decision for the owner, and it lands in
  `rashadoni/leaddrive-site`, not here. Left unchanged pending that decision.
- For the record, `leaddrivecrm.org/legal/{privacy,terms,data-deletion}`
  already `302` to the app's localized pages, so the destinations are reachable
  from that host even though the footer does not advertise them.
