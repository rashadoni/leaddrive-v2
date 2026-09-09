# Apify Instagram replies capability proof

Дата controlled POC: **2026-07-14** (Asia/Baku).

## Граница решения

- Bright Data остаётся primary route для Instagram post/media/top-level comments.
- `apify/instagram-comment-scraper` проверен только как capability-specific
  fallback для known-URL replies.
- Этот POC не включает production routing, discovery, live-send или обещание
  `90%` recall на платформе.
- Raw/live payload, URL цели, usernames и тексты комментариев в Git не
  сохранялись.

## До запуска

- Авторизованный Instagram UI подтвердил known-positive target: была видна
  ветка `Смотреть все ответы (3)`.
- Redacted target fingerprint: `sha256:9559ad37a015…`.
- Actor: `apify/instagram-comment-scraper`, maintained by Apify.
- Pinned build number: `0.0.502`; фактический immutable build ID:
  `b9EFc61xQ6Qctn1wM`.
- Input: один direct URL, `resultsLimit=15`,
  `includeNestedComments=true`.
- Run safeguards: `maxItems=20`, `maxTotalChargeUsd=0.055`, `timeout=180`,
  `restartOnError=false`, без retry/restart.
- Цена account snapshot: максимум `$0.0026` за comment/reply; расчётный
  item-cap `20 × $0.0026 = $0.052`, ниже run-level USD cap и разрешённых
  `$0.06`.
- [Run Actor API](https://docs.apify.com/api/v2/act-runs-post) подтверждает,
  что `maxTotalChargeUsd` ограничивает стоимость для всех pricing models.

## Результат

| Проверка | Результат |
| --- | ---: |
| Run status | `SUCCEEDED` |
| Run fingerprint | `TiqDis…` |
| Duration | `8.476 s` |
| Получено записей | `19` |
| Top-level comments | `15` |
| Reply rows | `4` |
| Parent groups | `2` |
| Reply parent links resolved | `4 / 4` |
| Уникальные IDs | `19 / 19` |
| Дубли ID | `0` |
| Missing ID/text/timestamp | `0 / 0 / 0` |
| Charged events | `19` |
| Фактическая стоимость | **`$0.0437`** |

Maintained actor возвращает replies отдельными строками. Reply URL имеет форму
`/p/<post>/c/<parent-id>/r/<reply-id>`, а `parentCommentUrl` —
`/p/<post>/c/<parent-id>/`. Parent identity надёжно извлекается из URL; для
сопоставления URL нужен единый trailing-slash normalization.

## Решение

Capability proof **пройден** для controlled known-positive URL. Build
`0.0.502` закреплён в адаптере; запуск всегда передаёт `restartOnError=false`.
Normalizer поддерживает как nested `replies[]`, так и фактическую flat-row
схему actor с `commentUrl`/`parentCommentUrl`.

Это не доказывает стабильность, pagination completeness или `>=90%` recall.
Production fallback остаётся выключенным до routing, evaluator и release gates;
14-дневное наблюдение учитывается отдельно.
