# Передача AAC / Uyumsoft integration в Claude Code

Дата: 14 октября 2026, Asia/Baku. Пользователь явно попросил «передай работу для клауд код». Этот запрос разрешает отдельный task-specific handoff и заменяет default Codex-only / auto-handoff OFF только для данной передачи. Общие AGENTS.md / CLAUDE.md не изменять.

## Задание от пользователя

Продолжить автономно всю подготовку нашей стороны для интеграции AAC: гибко настраиваемый конструктор данных/API, надёжная очередь, обработчик доставки и пригодные для расследования security logs. Довести самостоятельные работы до точки, где требуется фактическое подключение приёмного API заказчика; тогда сообщить, какие конкретные реквизиты/действия нужны. Не останавливаться на вопросах о фиксированной воронке или этапе: правила должны задаваться в конструкторе.

Начать с чтения session journal и runtime plan. Не переписывать сделанный конструктор и не объявлять всю интеграцию готовой. Ближайшая работа — transactional capture, bounded personal-payload storage и delivery worker с реальными PostgreSQL-доказательствами. Затем сбор остальных security-источников.

## Точное место продолжения

- Продолжать существующую задачу в `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-uiumsoft-api-security-flow`, ветка `codex/uiumsoft-api-security-flow`.
- Это development host Contabo / remote-alt под codex-alt, не Mac и не production. Не переходить в dirty canonical checkout `/home/codex-alt/projects/leaddrive-v2`.
- Origin: `https://github.com/rashadoni/leaddrive-v2.git`.
- PR: https://github.com/rashadoni/leaddrive-v2/pull/753 . OPEN; merge/deploy/auto-merge не выполнены на момент передачи.
- Последний проверенный application code: `552f2a1d48458132a3a999763b9723fb5147b9cd`.
- До handoff-файла local HEAD: `6ebc46e1472f732a0de0baa61fcce5e3875bd29f`; commits `17ffde830` и `6ebc46e14` содержат только journal/implementation doc/runtime plan/lexical inventory. Application code совпадает с проверенным SHA.
- Handoff сохраняется следующим checkpoint; после получения ветки определить актуальный HEAD через Git. Новая CI для следующего SHA не наследует формально результат предыдущего SHA.
- Начать с `codex-project-context`, `git status`, чтения AGENTS.md, CLAUDE.md, docs/DELIVERY-ARCHITECTURE.md и журнала. Если другой агент уже меняет это дерево, не редактировать его одновременно; сохранить историю и определить активный task checkout.

## Согласованная граница системы

Целевой поток: **LeadDrive CRM в будущем Azure → Site-to-Site VPN → private receiving API заказчика → его адаптер → Uyumsoft внутри сети заказчика**.

Наша сторона: approved JSON, secure delivery, durable capture/queue, receipts/recovery и наши security logs. Заказчик отвечает за receiving API, durable acceptance/deduplication, внутренний ERP mapping/adapter и внутренние ERP-ошибки. Изучение native ERP API/внутреннего устройства Uyumsoft не требуется от нас; нужен контракт принимающего API заказчика.

`accepted_by_api` не означает `erp_applied`. HTTP 2xx без совпадающего durable receipt не является подтверждением. Финальный ERP status — только явно согласованный дополнительный результат заказчика. Не добавлять ERP → CRM бизнес-синхронизацию или публичный inbound webhook автоматически.

Известно: клиент AAC, ERP внутри его сети, SIEM неизвестна — выбран JSONL. Неизвестны actual tenant будущей инсталляции, Azure owner/region/network, IP/endpoint, CA/mTLS/OAuth и receiving receipt lookup/dedup semantics. Компания с названием AAC в текущей CRM не является tenant ID. Редактирование draft привязано к session org; неизвестный tenant ID не блокирует универсальный конструктор.

Реальные данные не отправлялись, Azure/VPN не создавались. Текущий зарегистрированный LeadDrive production — **Contabo `13.140.132.245:/opt/leaddrive-v2`**, не будущая клиентская Azure-инсталляция. Выпуск только reviewed main → GitHub Actions `.github/workflows/deploy.yml` → SHA-bound artifact → smoke. Не использовать retired owner/host/архивные Azure pipelines. Передача Claude не разрешает merge, production deploy или реальную отправку. Перед видимым merge нужен owner go-ahead по delivery contract; до готового результата не спрашивать разрешение на обычную подготовку.

## Что реализовано

### Конструктор и защищённый API

- `src/lib/integrations/customer-receiver/constructor/`: catalogue, strict declarative profile, pure mapper/filter, source/Prisma adapter, receipt aliases, CAS draft store/history, audit export и OpenAPI proposal.
- Customer/contact/deal resources; approved native CRM fields и tenant-registered custom fields. Mapping field/context/constant, вложенные target paths, missing omit/null/reject; transform chains: trim/case, lossless decimal/rounding, UTC dates, affix, lookup codes. No eval/SQL/arbitrary scripts.
- Manual/all/filtered, all/any conditions; draft schedule/limits/POST-PUT/relative paths/receipt aliases/required log inventory. Эти настройки сами не включают scheduler/retention/sends.
- Session-only admin/superadmin API: `/api/v1/integrations/customer-receiver`, own-tenant catalogue и inactive ChannelConfig namespace `customer-receiver-draft`, atomic save+audit, revision CAS, до20 history versions при общем лимите512KiB, no-store.
- Общий channels API не может создать/изменить/активировать/переименовать receiver draft через dedicated-type guard.
- Public preview только на синтетических данных. Нет real-record preview, credentials/server URL/activation в public profile API.
- Profile/OpenAPI downloads требуют metadata audit до выдачи; значения/константы не копируются в audit. Audit failure →503 и файл не выпускается. Unapplied raw JSON блокирует preview/save/download.
- UI RU/AZ/EN: `src/components/settings/receiver-builder*`, `/settings/integrations/customer-receiver`; launcher добавлен с сохранением прежних sections. Не удалять/перестраивать UI без запроса владельца.
- OpenAPI3.1 proposal по включённым mappings/paths/methods/aliases. Bearer + mTLS описаны как согласуемая защита; actual token URL/receiver origin отсутствуют. Shared receiver path допускает несколько ресурсов через anyOf. Structural schema не заменяет бизнес-правила профиля.

### Kernel

- `src/lib/integrations/customer-receiver/`: strict proposed contract, stable event key/checksum, receipt classification, recovery/backoff, eligibility, transaction enqueue adapter, security event/JSONL schema, fixed-target HTTPS transport.
- Transport: trusted operator binding, HTTPS443, approved RFC1918 IPv4, CA/hostname verification, mTLS/Bearer, pinned connection без DNS/redirects, bounded request/response/timeouts. Public draft API этот sender не вызывает.
- Pure source snapshot и `prisma-source.ts` готовы как adapters; actual CRM mutation capture к ним не подключён.

### Logs: ограниченный реализованный scope

- `/api/v1/integrations/customer-receiver/logs`: только metadata audit конструктора (read/create/update/preview/profile export/contract export/log export), session admin своей org, target TEST/PROD, UTC period≤31days,≤5000events; превышение не усекать молча.
- JSONL + JSON Schema + manifest(counts/SHA256), stable event IDs, no raw values/headers/response bodies. Manifest не является подписью или доказательством полноты.
- TEST/PROD — логическая среда целевого профиля, не аттестация физической CRM-инсталляции.
- **Это не «все security logs».** Other CRM auth/access/admin, Azure/Entra/Key Vault, WAF/VPN, DB/host/deploy/backup/collector и customer API/ERP не подключены/не аттестованы этим export.

## Что НЕ завершено — следующий рабочий объём

1. Transaction-aware capture реальных CRM изменений и durable версии. Мутация, разрешённый snapshot/version и queue pointer должны быть в одной tenant-транзакции; rollback не оставляет отправку. Охватить CRUD, bulk/import, lead conversion, workflow/AI/inbox и relevant custom changes, а не только один REST route. Inventory:41files/72lexical calls; это не полный coverage certificate.
2. Временное encrypted personal-payload storage с bounded TTL и incident hold; immutable metadata ledger отдельно. **Existing EffectOutbox payload immutable, delete только whole-tenant cascade.** Current initial strict enqueue helper хранит envelope и не является готовым bounded PII-store. Не подключать его к реальным изменениям в текущем виде.
3. Delivery worker: atomic lease, committed started attempt до сетевого вызова, terminal evidence+transition atomic; customer-version dependencies; замороженные bytes/profile/catalogue/target binding; distributed rates/concurrency/backpressure/метрики.
4. Reconciliation: ambiguous outcome не повторять слепо. Existing EffectOutbox guards требуют matching attempts и dedicated operator+immutable decision evidence. Не обходить guards произвольным UPDATE/role escalation. Receipt lookup endpoint ещё не согласован с клиентом.
5. Security logs: реальный coverage inventory/collection, protected storage/exports, gaps/lag, retention/incident hold. Не выдавать self-audit конструктора за весь audit trail.
6. Server-side OAuth issuance/cache/rotation, Key Vault, actual Azure/VPN/private network и joint receiver acceptance. До actual connection — сообщить конкретные missing facts; не заменять их вымышленными IP/URL.

Read `docs/uiumsoft-runtime-capture-plan.md` целиком перед схемой/worker. Existing `appendDomainEvent` coherent allocator пишет head+DomainEvent+EventOutbox; нельзя использовать `event_aggregate_heads` как отдельный счётчик без события/outbox. CRM event profile B в catalog пока planned; весь CRM нельзя объявить event-integrated по одному helper.

## Проверки и их пределы

- 205 targeted tests/10files PASS; paths `src/__tests__/*customer-receiver*.test.ts` и `lib-event-platform-foundation.test.ts`.
- Scoped strict TS kernel/constructor без concrete Prisma adapter и UI PASS. Full generated-Prisma graph достиг2GiB heap на Contabo; повтор с увеличением heap запрещён, полный check выполнен в CI.
- Exact code552f2a1d4: all5 required PR gates PASS, production build PASS18m10s; run https://github.com/rashadoni/leaddrive-v2/actions/runs/38479938519 . Typecheck enforces existing baseline, не «0 исторических diagnostics». Baselines не изменять для обхода новых failures.
- Actual component browser smoke: RU/AZ/EN,1440x1050/390x900, save/preview, keyboard, precision override, CAS conflict/reload, history restore, JSONL links, profile/contract downloads, rejected active import, no overflow/page errors/external requests. **Standalone component+synthetic API, не full Next/RLS/DB proof.**
- Independent official OpenAPI document schema + JSON Schema validator:2documents/9cases PASS. Evidence `docs/evidence/customer-receiver-builder-2026-10-14/`.
- Actual builder adapter PostgreSQL/RLS/CAS/rollback, live OAuth/mTLS/VPN/customer API/ERP/SIEM — NOT RUN. Repository PG gates PASS не являются отдельным доказательством нового receiver runtime.

## Host / Git ограничения

- Сохранить dirty canonical checkout и другие worktrees. Продолжать dedicated branch/worktree, explicit paths-only stage/checkpoints. Не `git add .`, `git add -A`, reset hard, force push или destructive cleanup.
- Append-only `docs/uiumsoft-api-security-flow-session-log.md`: после каждого material phase записывать решения, результат/verification и exact next step. Не удалять историю, `.codex/sessions`, чужие artifacts или ранее сделанные commits. Не записывать secrets/PII в journal.
- Contabo: только малые последовательные targeted checks. До локального check смотреть RAM/disk/pressure. Node20 `/home/codex-alt/.local/bin`.
- Никаких full build/full browser E2E/dependency-wide indexing/large generated-Prisma TS на Contabo. Heavy verification — GitHub-hosted Linux CI/approved worker. Один targeted install/test/check за раз. Каждый unrun gate помечать NOT RUN с причиной.
- Current worktree node_modules — ignored symlink на `/tmp/leaddrive-receiver-checks/node_modules` с минимальными временными test deps. Package/lock приложения не менялись. Не считать эту среду полноценной install приложения и не коммитить symlink/cache.
- Browser proof: `scripts/customer-receiver-builder-proof.mjs`; available browser `/home/codex-alt/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell`. Передать `RECEIVER_PROOF_BROWSER` и output dir. Это targeted smoke, не full app build/E2E.
- Секреты через environment/secret references; не печатать credentials, private keys или auth files. Не подключаться к чужой Claude-сессии/терминалу и не брать её credentials.

## Документы / готовые файлы

- `docs/uiumsoft-api-security-flow-session-log.md` — полная история требований/решений/проверок.
- `docs/uiumsoft-aac-implementation.md` — реализованный scope, remaining gates и ориентир40–64 engineer hours полного первоначального объёма (не календарный SLA/не измеренное agent time).
- `docs/uiumsoft-runtime-capture-plan.md`, `docs/evidence/customer-receiver-builder-2026-10-14/crm-capture-candidates.json` — следующие шаги/кандидаты source coverage.
- `docs/uiumsoft-api-security-flow.az.md`, `.en.md` — agreed design v1.1, не certificate deployed connection.
- `docs/uiumsoft-api-preparation-package/`: separate AZ/EN Word files, ZIP, manifest. OpenAPI example внутри ZIP синтетический; final contract генерировать из approved customer profile.
- Existing Pages AZ https://chatgpt.com/space/page_d0f95f28d1688191baf5748a94981ff0 и EN https://chatgpt.com/space/page_cdb70e7c8af88191a01d8ed6dc2a7d13 . Не создавать дубликаты/не менять sharing без запроса; работу продолжать в repo.

## Первое действие Claude

Подтвердить пользователю принятие контекста и exact worktree/branch, затем прочитать journal+runtime plan и реализовать storage/capture/worker с безопасными disabled-by-default gates. Не спрашивать заново, можно ли выполнять уже разрешённую подготовку. Задавать только действительно отсутствующие данные при достижении client connection point; native Uyumsoft internals не запрашивать. Перед каждым завершённым material turn давать короткий русский continuity block: статус, последнее действие, точка остановки, следующее действие.

Факт передачи файла не означает, что Claude уже запущен или подтвердил получение. Прямой connected Claude channel из текущего Codex-чата отсутствовал; его запуск/принятие нужно подтвердить в Claude Code.
