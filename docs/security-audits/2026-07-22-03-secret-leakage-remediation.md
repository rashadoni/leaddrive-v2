# Security audit #3 — remediation

Дата: 2026-07-22

## Выполнено

- Удалены предсказуемые WhatsApp/Instagram verify tokens из `.env.example`; значения теперь пустые и должны задаваться только через deployment secrets.
- Удалены из tracked security-документов fallback-secret и старые development-secret значения; вместо них оставлены redacted descriptions.
- Проверен текущий runtime-код portal auth: `NEXTAUTH_SECRET` уже обязателен, hardcoded fallback отсутствует.
- Проверено, что публичные/client-файлы не содержат non-`NEXT_PUBLIC_` env references или credential-полей.
- Удалены ранее созданные локальные Postman-архивы.

## Проверки

- `npx vitest run src/__tests__/api-instagram-webhook-signature.test.ts src/__tests__/api-webhooks-mgmt.test.ts src/__tests__/lib-secure-token.test.ts` — 3 files, 53 tests passed.
- `git diff --check` — passed.
- Повторный поиск audited literals (`portal-secret`, старые webhook defaults, dev secret) — совпадений нет.

## Остаточные действия

- Production secret values не выводились и не ротировались; нужна отдельная проверка deployment secret metadata и ротация, если старые/default значения когда-либо использовались.
- В коде остаются другие development fallbacks для OAuth helper paths (`ld-social-oauth`, `dev-secret`); они не были частью подтверждённых findings этого аудита и требуют отдельного scope, если решим закрывать их системно.

Кодовые изменения этого remediation checkpoint ещё не отправлялись в `main` и не деплоились.
