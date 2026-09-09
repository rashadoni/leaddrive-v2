# Social Monitoring — шаблон клиентского coverage contract (CR-0)

Статус: шаблон для платного управляемого пилота. Источник истины коммерческой
готовности — [`SOCIAL-MONITORING-CLIENT-READINESS.md`](./SOCIAL-MONITORING-CLIENT-READINESS.md).

Этот документ — коммерческая обёртка. Технический annex генерируется из системы и
не заполняется вручную:

- UI: **Social Monitoring → Источники → Статус → «Карта покрытия»**.
- Экспорт: `GET /api/v1/social/coverage-contract?format=markdown` (кнопка
  «Coverage contract»). JSON-вариант — тот же endpoint без `format`.
- И UI, и экспорт считаются из одного модуля
  `src/lib/social/capability-inventory.ts`, поэтому договор и интерфейс не
  расходятся.

Никогда не вставляйте в договор секреты, токены, cookies или production payload.
Прикладывайте только сгенерированный annex и заполненные ниже поля.

## 1. Обещание (что продаём)

> LeadDrive отслеживает согласованные объекты и источники в пределах явно
> показанного покрытия, отделяет релевантные упоминания от шума, собирает
> evidence, классифицирует риск и готовит AI-черновики для утверждения человеком.

Не обещаем и не включаем в договор:

- «все комментарии во всех соцсетях»;
- гарантированное обнаружение контента из закрытых/недоступных аккаунтов;
- официальный reply только потому, что scraper/provider вернул comment ID;
- юридическую квалификацию, вынесенную AI;
- автоматическую публикацию без отдельного release review;
- бессрочное хранение platform content;
- стабильность best-effort scraper на уровне официального API.

Live-отправка выключена. AI работает draft-first. Юридические кандидаты
подтверждает человек.

## 2. Лестница статусов покрытия

Каждая capability в annex имеет ровно один статус:

| Статус | Значение | Продаётся как активный сбор? |
| --- | --- | --- |
| `PRODUCTION_VERIFIED` | Проверено на реальном payload, есть capability proof | Да |
| `SANDBOX_VERIFIED` | Проверено в sandbox, production canary не пройден | Только под пометкой «pilot canary» |
| `CONFIGURED` | Есть credentials/настройка, proof отсутствует | Нет — «в работе» |
| `IMPLEMENTED` | Код есть, tenant не настроен | Нет |
| `BLOCKED` | Нет легального/стабильного пути без внешнего решения | Нет |

Только `PRODUCTION_VERIFIED` route попадает в перечень оплачиваемого сбора. Всё
остальное фиксируется как ограничение или «следующий шаг», но не как обещание.

## 3. Согласованный scope (заполняется на клиента)

- Клиент/tenant: `__________`
- Объекты мониторинга (subjects): `__________`
- Языки/география: `__________`
- Дата согласования: `__________`
- Ответственный owner пилота: `__________`
- Support channel: `__________`

## 4. Матрица покрытия по платформам (заполняется из annex)

Для каждой продаваемой платформы вставьте строку из сгенерированного annex и
подтвердите договорные поля. Пустые/`—` поля означают, что пункт ещё не доказан.

| Платформа | Capability | Статус | Read scope | Reply scope (engagement) | Sender identity | Историческая глубина | Cadence/latency | Provider/adapter | Retention | Дата проверки / срок proof | Стоимость 1 нового упоминания |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Facebook | | | | | | | | | | | |
| Instagram | | | | | | | | | | | |
| TikTok | | | | | | | | | | | |
| YouTube | | | | | | | | | | | |
| Telegram | | | | | | | | | | | |
| VK | | | | | | | | | | | |
| X (Twitter) | | | | | | | | | | | |

Правила заполнения:

- `Read scope` и `Reply scope` — разные capabilities. Возврат текста/ID чужого
  комментария не даёт права ответить через официальный API.
- `Reply scope` из annex — это `engagementMode`: `API_REPLY`, `PROVIDER_REPLY`,
  `OPEN_NATIVE`, `COPY_DRAFT` или `NO_ACTION`. `OPEN_NATIVE`/`COPY_DRAFT` = ручное
  действие сотрудника, CRM не подтверждает публикацию автоматически.
- `Provider/adapter` для external Instagram/Facebook/TikTok — licensed provider
  или маркированный best-effort Apify actor, прошедший policy review. Apify
  никогда не заменяет доступный более приоритетный adapter.
- `Retention` берётся из проверенного capability proof и раздела 8 архитектурного
  плана; клиент может только ужесточить срок.
- `Дата проверки / срок proof` — из полей `verifiedAt`/`sandboxVerifiedAt` и
  `expiresAt`. Истёкший proof переводит route обратно ниже `PRODUCTION_VERIFIED`.

## 5. Приоритет источников

Официальный API → подключённый аккаунт → licensed provider → маркированный
best-effort Apify → manual URL. При наличии более приоритетного рабочего способа
нижестоящий не запускается. Скрытый scraping, cookies, proxy, CAPTCHA и browser
automation в обход платформы не используются.

## 6. Данные, приватность и удаление

- Retention policy показывается до запуска источника.
- Tenant может запросить export и deletion; deletion выполняется во всех слоях
  (DB, object storage, cache, embeddings, AI traces, provider datasets) и
  логируется в deletion ledger.
- Legal hold не отменяет обязательное platform deletion.
- Terms/Privacy/DPA и список subprocessors прикладываются отдельно (см. CR-6).

## 7. Стоимость и лимиты

- Провайдерские, OCR, ASR, LLM, storage и egress расходы измеряются по tenant.
- Hard budget gate блокирует новый платный вызов до его выполнения, не теряя уже
  найденный lead (см. CR-8).
- Тариф не обещает неподтверждённое platform coverage.

## 8. Подписи

| Роль | Имя | Дата | Подпись |
| --- | --- | --- | --- |
| Клиент | | | |
| LeadDrive owner | | | |

Приложение: сгенерированный `coverage-contract-<date>.md` (технический annex).
