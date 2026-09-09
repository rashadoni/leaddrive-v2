# Social Monitoring — руководство по разметке gold/control dataset

Статус: **versioned labeling contract v1**.

Дата: 2026-07-14.

Этот документ задаёт одинаковые правила ручной разметки для relevance, topic,
sentiment и полноты provider data. Он применяется к AZ/RU/EN control corpus и
не заменяет юридическое решение о допустимости источника.

## 1. Единица разметки

Одна строка dataset — один публичный объект с устойчивой identity:

- post/article/video;
- comment;
- reply с обязательным parent comment ID;
- image/cover/frame observation;
- transcript/OCR fragment, связанный с исходным объектом.

Одинаковый объект, полученный двумя providers, остаётся одной ground-truth
единицей. Provider и acquisition route записываются как provenance, а не как
часть identity.

## 2. Обязательные поля

| Поле | Правило |
| --- | --- |
| `itemId` | Стабильный ID строки dataset |
| `platform` | Нормализованная платформа или `web` |
| `contentKind` | `POST`, `COMMENT`, `REPLY`, `ARTICLE`, `VIDEO`, `IMAGE`, `TRANSCRIPT`, `OCR` |
| `url` | Canonical public URL, если доступен |
| `externalId` | Platform ID, если виден |
| `postExternalId` | Обязателен для comment/reply, если provider его отдаёт |
| `parentExternalId` | Обязателен для reply |
| `locale` | Язык самого содержимого: `az`, `ru`, `en`, `mixed`, `unknown` |
| `text` | Текст или расшифровка без исправления авторской орфографии |
| `expectedRelevance` | `ACCEPTED`, `REVIEW`, `REJECTED` |
| `expectedSubjectIds` | Все реально упомянутые monitoring subjects |
| `expectedTopic` | Один основной topic из утверждённой taxonomy |
| `expectedSentiment` | `positive`, `neutral`, `negative`, `mixed`, `unknown` |
| `visibleMedia` | Какие video/image/cover/audio элементы видны аналитику |
| `visibleCommentIds` | Provider-visible comments/replies для recall denominator |
| `exclusionReason` | Обязателен для `REJECTED` и исключённых denominator rows |
| `annotatorId` | Псевдоним аналитика, не email/ФИО |
| `labeledAt` | ISO timestamp |

## 3. Relevance

### `ACCEPTED`

Ставится, когда объект действительно относится к subject и содержит достаточно
контекста для мониторинга:

- точное имя, официальный handle/domain или однозначный alias;
- узнаваемая транслитерация/склонение вместе с контекстом;
- comment/reply под релевантным post, если coverage contract включает thread
  context;
- визуальное/аудио упоминание подтверждено OCR/ASR или ручной проверкой.

### `REVIEW`

Ставится, когда автоматическое решение небезопасно:

- короткий или омонимичный alias без достаточного контекста;
- только изображение/аудио, а OCR/ASR отсутствует или confidence ниже порога;
- конфликт subject aliases/exclusions;
- sarcasm, mixed language или неоднозначная цитата;
- provider вернул snippet, но не извлечён исходный текст.

### `REJECTED`

Ставится, когда объект не относится к subject:

- совпадение только по стоп-слову/negative alias;
- явно сработало exclusion rule;
- совпадение находится только в навигации, рекламе или unrelated sidebar;
- search result ведёт не на требуемый объект;
- дубликат не является новой ground-truth единицей.

Недоступный/private/deleted объект не маркируется `REJECTED`: он получает
`exclusionReason=NOT_PUBLICLY_OBSERVABLE` и исключается из recall denominator.

## 4. Topic

Topic описывает предмет сообщения, а не канал или тональность.

1. Выбрать самый конкретный утверждённый topic.
2. Если подходят два, выбрать тему, без которой смысл объекта изменится сильнее.
3. Если контекста недостаточно — `unknown` и `REVIEW`.
4. Нельзя создавать новую тему внутри разметки; предложение новой taxonomy
   фиксируется отдельно.

Комментарии и replies размечаются по собственному тексту. Topic родительского
post не наследуется автоматически.

## 5. Sentiment

Sentiment ставится относительно subject, а не общего эмоционального тона:

- `positive` — одобрение, благодарность, рекомендация subject;
- `negative` — критика, жалоба, обвинение или выраженный риск для subject;
- `neutral` — факт, вопрос или информационное упоминание без оценки;
- `mixed` — одновременно существенные положительная и отрицательная оценки;
- `unknown` — недостаточно текста/контекста или невозможно надёжно понять
  sarcasm.

Emoji учитываются только вместе с контекстом. Один `🔥` может быть positive, но
один `😂` без контекста остаётся `unknown`. Репост чужой критики без собственной
позиции — `neutral`, если автор явно не поддерживает её.

## 6. Comments, replies и denominator

- Comment и reply считаются отдельными объектами.
- Reply включается в denominator только когда аналитик реально видит его в
  публичном UI или approved reference export.
- Счётчик `21 comments` без раскрытого списка не создаёт 21 expected IDs.
- Если UI показывает ветку replies, но provider возвращает только top-level
  comments, это provider miss, а не true zero.
- Reply без parent identity считается schema-invalid и не засчитывается как
  корректно извлечённый reply.
- Deleted/hidden/moderated comments отмечаются отдельным exclusion reason и не
  используются для наказания provider, если на момент canary они уже не видны.

## 7. Media и обложки

Для каждого post/video аналитик фиксирует видимые типы: `video`, `image`,
`carousel`, `thumbnail`, `cover`, `audio`, `caption`.

- CDN URL не обязан совпадать между providers; сравнивается тип и связь с
  исходным объектом.
- Истёкший signed URL считается delivery failure только если URL был уже
  недействителен в момент получения.
- OCR/ASR text не заменяет исходный caption; это отдельный evidence fragment.
- Скачивание binary asset не является обязательным, если policy разрешает
  хранить только URL/metadata.

## 8. Двойная разметка и разногласия

1. Каждый acceptance sample размечают два аналитика независимо.
2. Они не видят provider result и метрики друг друга до завершения labels.
3. Совпадение требуется по relevance, subject, topic и sentiment.
4. Разногласие рассматривает третий adjudicator и записывает `decisionReason`.
5. Нельзя менять label только для прохождения 90% gate; изменение правила требует
   новой версии guide и dataset.

Минимальный inter-annotator gate перед evaluation:

- relevance agreement `>= 0.90`;
- sentiment agreement `>= 0.85`;
- все reply parent IDs и denominator exclusions согласованы на 100%.

## 9. Quality control

Перед freeze dataset:

- нет secret/token/live payload beyond approved redacted evidence;
- нет строк без locale, relevance и provenance;
- все `REPLY` имеют parent ID;
- все `REJECTED`/excluded строки имеют reason;
- canonical IDs/URLs не дублируют одну ground-truth единицу;
- AZ/RU/EN, platforms и content kinds представлены отдельными cohorts;
- dataset version и guide version записаны в manifest;
- после freeze разрешены только append-only corrections с changelog.

## 10. Короткие примеры

| Текст | Контекст | Relevance | Sentiment |
| --- | --- | --- | --- |
| `LeadDrive dəstəyi problemi tez həll etdi` | Точное имя продукта | `ACCEPTED` | `positive` |
| `После обновления LeadDrive заявки исчезли` | Точное имя продукта | `ACCEPTED` | `negative` |
| `Can LD do this?` | `LD` — ambiguous alias, контекста нет | `REVIEW` | `unknown` |
| `Новый привод LD-200` | Negative alias/exclusion для промышленной детали | `REJECTED` | `neutral` |
| `Спасибо!` | Reply под релевантным comment, thread context входит в contract | `ACCEPTED` | `positive` |

Любой новый неоднозначный класс сначала добавляется в guide/changelog, затем
переразмечается соответствующий cohort.
