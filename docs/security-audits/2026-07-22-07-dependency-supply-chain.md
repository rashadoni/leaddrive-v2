# Dependency supply-chain audit — 2026-07-22

## Scope

Checked dependency supply-chain risk for:

- root Next.js app (`package.json`, `package-lock.json`)
- Telegram bridge (`telegram-bridge/package.json`, `telegram-bridge/package-lock.json`)
- Remotion helper package (`video/remotion-ai-actions/package-lock.json`)

This audit focused on known vulnerable packages, lockfile integrity, install-time execution risk, and high-risk outdated/deprecated dependency chains.

## Result

| Area | Before | After | Status |
| --- | ---: | ---: | --- |
| Root app `npm audit` | 13 vulnerabilities: 7 moderate, 6 high | 3 vulnerabilities: 2 moderate, 1 high | Partially fixed; residual items documented below |
| `telegram-bridge npm audit` | 10 vulnerabilities: 7 moderate, 1 high, 2 critical | 0 vulnerabilities | Fixed |
| `video/remotion-ai-actions npm audit` | 1 high vulnerability | 0 vulnerabilities | Fixed |
| Lockfile install-like scripts | 0 | 0 | No install/preinstall/postinstall/prepare scripts found |
| Registry signatures | not checked | root 1219/1219, telegram 1/1, remotion 251/251 verified | Passed |

## Fixed

### Root app

- Updated `@anthropic-ai/sdk` from `^0.80.0` to `^0.112.5`.
  - Fixes Anthropic SDK memory-tool filesystem advisories reported by `npm audit`.
- Updated Auth.js packages:
  - `@auth/prisma-adapter` to `^2.11.3`
  - `next-auth` to `^5.0.0-beta.32`
- Updated `next` to `^16.2.11`.
- Updated `@serwist/next` and `serwist` to `^9.5.12`.
- Updated root `sharp` to `^0.35.3`.
- Added targeted npm `overrides`:
  - `fast-uri` to `^3.1.4`
  - `micromatch -> picomatch` to `^2.3.2`
  - `postcss` to `^8.5.21`
  - `sharp` to the root safe `sharp` version

### Telegram bridge

- Updated `node-telegram-bot-api` from `^0.66.0` to `^1.2.0`.
- This removed the old `request` dependency chain and cleared the critical SSRF/form-data/qs/tough-cookie audit findings.

### Remotion helper

- Refreshed the lockfile to currently resolvable Remotion packages.
- Cleared the `fast-uri` advisory in the helper package.

### SMTP typing cleanup

- Removed two `any` usages from `src/app/api/v1/settings/smtp/test/route.ts`.
- No runtime behavior change intended.

## Residual findings

### P1 — `nodemailer` remains vulnerable by npm advisory

`npm audit` still reports `nodemailer@7.0.13` with high severity advisories. The safe npm fix is `nodemailer@9.0.3`, but `next-auth@5.0.0-beta.32` / `@auth/core@0.41.3` currently declares an optional peer dependency of `nodemailer ^7.0.7 || ^8.0.5`.

Attempting to install `nodemailer@9.0.3` without forcing fails peer resolution. Forcing it would risk breaking `npm ci` and production deploy reproducibility.

Recommended next step: split application email sending away from the Auth.js optional peer path, or wait for Auth.js to support Nodemailer 9, then upgrade `nodemailer` to `^9.0.3`.

Current mitigation observed in code: SMTP test route strips CRLF from header-derived sender fields before `sendMail`.

### P2 — `exceljs -> uuid@8.3.2` remains flagged

`npm audit` reports `uuid <11.1.1` through `exceljs@4.4.0`. The suggested npm audit fix is a downgrade to `exceljs@3.4.0`, which is not an acceptable security fix.

Forcing `uuid@11` under ExcelJS is risky because it is a major-version transitive override and may break ExcelJS runtime behavior. Keep this as a monitored residual until ExcelJS publishes a compatible update or the export code is migrated.

## Reusable checklist for other projects

1. Identify every package root:
   - `package.json`
   - `package-lock.json`
   - nested app/tool folders
2. Run `npm audit --json` per package root.
3. Check lockfile install-time scripts:
   - `preinstall`
   - `install`
   - `postinstall`
   - `prepare`
   - `prepack`
   - `postpack`
4. Verify registry signatures where npm supports it:
   - `npm audit signatures`
5. Fix direct dependencies first.
6. Use narrow `overrides` for transitive advisories only when the replacement stays API-compatible.
7. Do not blindly run `npm audit fix --force`.
8. Re-run install from lockfile:
   - `npm ci --ignore-scripts`
9. Run targeted tests for touched dependency surfaces.
10. Document residual risks with reason, owner, and next action.

## Verification

Commands run from `/tmp/leaddrive-dependency-audit-oHYtVY` unless noted:

- `npm audit --json`
- `npm audit --json` in `telegram-bridge`
- `npm audit --json` in `video/remotion-ai-actions`
- lockfile install-script scan for all three lockfiles: passed, zero install-like scripts found
- `npm ci --ignore-scripts`: passed
- `npm ci --ignore-scripts` in `telegram-bridge`: passed
- `npm ci --ignore-scripts` in `video/remotion-ai-actions`: passed
- `npx prisma generate`: passed
- `npm audit signatures`: passed for root app
- `npm audit signatures` in `telegram-bridge`: passed
- `npm audit signatures` in `video/remotion-ai-actions`: passed
- `npx vitest run src/__tests__/anthropic-client-factory.test.ts src/__tests__/no-bare-anthropic-constructor.test.ts src/__tests__/lib-secure-smtp.test.ts src/__tests__/lib-workflow-email-notifications.test.ts`: passed, 43 tests
- `npx vitest run src/__tests__/lib-secure-smtp.test.ts src/__tests__/api-settings.test.ts`: passed, 30 tests
- `npm run lint -- src/lib/ai/anthropic-client.ts src/lib/secure-smtp.ts src/lib/email.ts src/app/api/v1/settings/smtp/test/route.ts`: passed
- `node --check telegram-bridge/bot.js`: passed
- `node --check video/remotion-ai-actions/scripts/render.mjs`: passed
- `git diff --check`: passed

Not run / blocked:

- Full `npm run typecheck` failed due Node heap out-of-memory at both default ~2 GB and `NODE_OPTIONS=--max-old-space-size=4096`. No TypeScript diagnostics were produced before OOM.
- `npm run build` was not run locally because production deploy builds must be performed by GitHub Actions, not by manual live-server build.
