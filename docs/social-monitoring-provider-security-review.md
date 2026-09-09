# Social Monitoring — provider security/privacy review

Дата проверки: 2026-07-14  
Scope: Bright Data и Apify для внешнего social monitoring.  
Статус release gate: `BLOCKED_EXTERNAL`.

Этот документ фиксирует техническую часть `SM-PR-080`. Он не является
юридическим заключением и не заменяет принятие DPA, privacy basis и provider
terms владельцем продукта/юристом.

## 1. Итог

Локальные security controls и fail-closed проверки готовы. Production provider
routing, live-send и 14-дневный production-like shadow нельзя включать, пока не
приняты решения из §4.

Главный открытый риск — условия Bright Data: действующий MSA разрешает Bright
Data хранить данные, которые клиент собрал через proxy/data services, и
использовать собранные или доставленные данные для собственных целей. Для Web
Scraper/Data Services клиент также самостоятельно отвечает за lawful basis,
уведомления и права субъектов данных. Это требует явного contract/privacy
решения, а не только технической настройки.

## 2. Provider facts

| Область | Bright Data | Apify | Вывод |
| --- | --- | --- | --- |
| Договорная роль | MSA отсылает к DPA, если Bright Data обрабатывает personal information как processor | Публичный DPA описывает processor obligations | Order/account-specific DPA acceptance нужно подтвердить отдельно |
| Provider retention | Snapshot download results доступны 16 дней; MSA отдельно оставляет Bright Data право retain/use collected or delivered data | Unnamed storage следует retention плана; named storage хранится бессрочно | Не создавать named storage; Bright retention/use требует owner/legal approval |
| Subprocessors/transfers | Trust Center и DPA должны быть приняты для конкретного аккаунта/use case | DPA даёт 10 дней на objection и допускает международные transfers с safeguards | Зафиксировать актуальный список и разрешённые регионы до production-like данных |
| Incident/security posture | Trust Center заявляет ISO 27001/27017/27018, SOC 2 и SOC 3 | Apify заявляет SOC 2 Type II; DPA обещает уведомление о known breach не позднее 72 часов | Сертификаты — supporting evidence, но не заменяют contract acceptance |
| Data/use responsibility | Клиент отвечает за lawful basis, notices, data-subject rights и соблюдение third-party rights | Customer остаётся controller и задаёт permitted purpose | Нужны утверждённые monitoring subjects, public-only policy и DSR/deletion process |

Официальные источники:

- [Bright Data Master Service Agreement](https://brightdata.com/license)
- [Bright Data DPA](https://brightdata.com/static/web/Bright-Data-Data-Protection-Agreement.pdf)
- [Bright Data Acceptable Use Policy](https://brightdata.com/trustcenter/acceptable-use-policy-bright-data)
- [Bright Data Trust Center](https://brightdata.com/trustcenter)
- [Bright Data snapshot retention](https://docs.brightdata.com/api-reference/scrapers/delivery-apis/download-snapshot)
- [Apify Data Processing Addendum](https://docs.apify.com/legal/data-processing-addendum)
- [Apify storage and retention](https://docs.apify.com/storage)
- [Apify security](https://docs.apify.com/security)

## 3. Технические controls и evidence

| Control | Состояние | Evidence |
| --- | --- | --- |
| Tenant isolation | `PASS_LOCAL` | PostgreSQL integration suite: 9/9 RLS tests под `NOBYPASSRLS` role |
| Provider webhook auth/replay | `PASS_LOCAL` | Context-bound Bearer, body/compression limits, snapshot binding и idempotent transition; targeted suite прошла |
| Paid-route budget | `PASS_LOCAL` | Reservation до dispatch, per-run hard cap, daily/monthly fail-closed и idempotent finalizer |
| Shadow side effects | `PASS_LOCAL` | Comparison harness требует `allowPersistence=false` и отдельные request/USD caps |
| Network destinations | `PASS_LOCAL` | Provider/search/reply/media paths используют environment allowlists и public URL guards |
| Observation retention | `PASS_LOCAL` | `purgeAt`, purge job, deletion ledger и tombstone/scrub paths покрывают transit/raw/media/provider-run data |
| External/public sends | `OFF` | Отдельные global/tenant/provider gates; scenario/source defaults не разрешают live external send |
| Dependency audit | `RISK_ACCEPTANCE_REQUIRED` | Next обновлён до 16.2.10. Остаётся high advisory Nodemailer без доступной fixed release; добавлены private-host/CRLF/TLS guards, header validation и `disableFileAccess`/`disableUrlAccess` |
| Secret hygiene | `PASS_LOCAL` | Токены не включены в Git/evidence; leak scan checkpoint-коммита прошёл |

Последняя локальная проверка security-slice:

- 6 test files / 97 tests — pass;
- social typecheck — pass;
- ESLint изменённых TypeScript files — pass;
- production Next build — pass;
- `git diff --check` — pass.

## 4. BLOCKED_EXTERNAL — обязательные решения

До смены `SM-PR-080` на `DONE` нужны все пункты:

1. Product/legal owner письменно принимает Bright Data DPA/MSA для данного use
   case либо выбирает provider/contract, запрещающий provider secondary use.
2. Утверждены lawful basis, privacy notice, DSR/deletion process и public-only
   collection policy для social profiles, posts, comments и media metadata.
3. Проверены и приняты актуальные subprocessors, processing regions и
   international-transfer safeguards Bright Data и Apify.
4. Утверждена provider-side retention policy: Bright snapshot не дольше
   документированного окна; Apify storage остаётся unnamed и получает явный
   retention; named indefinite storage запрещён.
5. Владелец принимает compensating controls для Nodemailer advisory без fixed
   release либо SMTP-функции исключаются из release scope до появления fix.
6. Утверждены production-like source list, provider hosts, месячный budget и
   incident contacts.

## 5. Следующий безопасный шаг

После выполнения §4:

1. сохранить только факт approval и contract version без секретов;
2. повторить security/RLS/budget/retention test matrix;
3. перевести `SM-PR-080` в `DONE`;
4. только затем разрешить старт `SM-PR-082` в capped, no-persistence shadow
   режиме. Live-send и production provider routing остаются отдельными gates.
