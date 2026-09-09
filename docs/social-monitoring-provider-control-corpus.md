# Social Monitoring — control corpus и правила измерения provider coverage

Статус: исполнимый specification для `SM-PR-003`–`005`, `SM-PR-011` и
`SM-PR-061`. Версия схемы: `social-provider-control-v2`.

Этот corpus нужен не для обучения модели, а для воспроизводимого сравнения
официальных API, licensed providers и Apify. Он не запускает production ingest и
не записывает результаты в Prisma.

## 1. Единица корпуса

Одна строка соответствует одной платформе, одному языку и одному поисковому
запросу. В ней перечисляются известные публичные URL и те capabilities, которые
обязаны быть проверены на этих URL.

Обязательные поля:

- `id` — стабильный идентификатор без персональных данных;
- `platform` — нормализованный platform key;
- `locale` — `az`, `ru` или `en`;
- `contentKind` — тип проверяемого объекта (`POST`, `VIDEO`, `COMMENT`, `REPLY`);
- `query` — фактический запрос с брендом/alias/handle;
- `expectedUrls` — известные публичные URL, подтверждённые аналитиком;
- `requiredCapabilities` — capabilities, которые должны участвовать в gate.

Для `READ_COMMENTS`, `READ_MEDIA` и `UPDATE_METRICS` соответствующие expected
поля обязательны. Пустой denominator для обязательной capability считается
ошибкой корпуса, а не успешным результатом.

`expectedCommentIds`/`expectedMediaKinds` фиксируют всё, что аналитик видит на
платформе. `providerVisibleCommentIds`/`providerVisibleMediaKinds` фиксируют
доказанное подмножество, доступное конкретному provider route. Provider-visible
множество обязано быть subset owner-visible множества; иначе corpus отклоняется
до внешнего вызова.

Пример доступен в
[`examples/social-monitoring-provider-control-corpus.example.json`](./examples/social-monitoring-provider-control-corpus.example.json).

## 2. Минимальный объём

До provider decision корпус должен содержать:

- не менее 50 известных URL на каждую обязательную платформу;
- минимум 10 video posts и 10 объектов с видимыми comments/replies на платформу,
  если эти виды контента входят в коммерческий scope;
- AZ/RU/EN запросы для каждого обязательного monitoring subject;
- positive queries, aliases, handles, transliterations и negative/noise queries;
- свежие и более старые публикации внутри согласованной historical depth;
- отдельные owned, external professional и public-web cohorts.

Один и тот же URL может входить в несколько query cohorts, но в итоговой
стоимости и accepted-unique метрике учитывается один раз.

## 3. Метрики и denominators

Метрики считаются по provider и каждому обязательному
`platform × locale × contentKind` cohort. Общая средняя не может скрыть провал
отдельного cohort.

| Метрика | Числитель | Знаменатель | Gate |
| --- | --- | --- | ---: |
| Discovery recall | найденные expected URL | все expected URL | `>= 90%` |
| Discovery precision | найденные URL из expected set | все уникальные найденные URL | `>= 90%` |
| Enrichment completeness | expected URL с валидным enriched content | все expected URL | `>= 95%` |
| Comment recall (provider-visible) | найденные expected comment/reply IDs | provider-visible expected IDs | `>= 90%` |
| Comment recall (owner-visible) | найденные expected comment/reply IDs | все видимые аналитику expected IDs | `>= 90%` |
| Media completeness (provider-visible) | найденные expected media kinds | provider-visible expected media kinds | `>= 95%` |
| Media completeness (owner-visible) | найденные expected media kinds | все видимые аналитику expected kinds | `>= 95%` |
| Metric completeness | возвращённые expected metric fields | все expected metric fields | `>= 95%` |
| Schema validity | ответы, прошедшие runtime contract | все provider calls | `>= 99%` |

`provider-visible` означает, что объект доступен по согласованному легальному
маршруту и подтверждён аналитиком во время маркировки. Закрытый, удалённый или
геоблокированный объект не включается задним числом в denominator; изменение
его статуса фиксируется новой версией dataset.

`true zero` — валидный ответ provider и не является технической ошибкой. Он
ухудшает recall, но не открывает circuit breaker и не запускает платный fallback
автоматически.

## 4. Стоимость

Каждый provider response обязан вернуть `amountUsd` либо проверяемые units,
которые затем переводятся в USD по зафиксированному price snapshot.

Основная метрика:

```text
costPerAcceptedUniqueUsd = totalCostUsd / unique expected URLs found by discovery
```

Если accepted unique равен нулю, стоимость на единицу имеет значение `null`, а
не `0`: нулевая выдача не является бесплатным успехом.

## 5. Процесс разметки

1. Аналитик сохраняет URL и platform-visible IDs комментариев/медиа.
2. Второй аналитик проверяет relevance и доступность.
3. Разногласия разрешаются до изменения `datasetVersion`.
4. В Git попадают только публичные URL и синтетические/редактированные примеры.
5. Клиентские payload, cookies, tokens, private comments и PII в corpus не
   сохраняются.
6. Любое изменение expected set создаёт новую immutable версию dataset.

## 6. Запуск harness

Чистое ядро находится в:

- `src/lib/social/provider-capability-contract.ts` — runtime contract и граница
  candidate → enriched content;
- `src/lib/social/provider-comparison.ts` — side-effect-free comparison и gates.

Реальные adapter wrappers должны реализовать `ProviderCapabilityAdapter`. Harness
передаёт им один и тот же corpus, проверяет contract version, считает coverage и
стоимость, но не вызывает `ingestMentionWithResult`.

До появления credentials используются fixture adapters. Результат fixture-теста
доказывает корректность математики и fail-closed поведения, но не покрытие
Bright Data, Data365 или Apify.
