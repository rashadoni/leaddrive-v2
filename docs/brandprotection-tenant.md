# Brand Protection tenant — runbook

Отдельный тенант под проект защиты репутации: `brandprotection.leaddrivecrm.org`
(slug `brandprotection`, shared-инстанс LeadDrive, тот же процесс/порт 3001).
Все настройки соц-мониторинга переносятся из исходного тенанта скриптом —
заново ничего настраивать не нужно.

## Что внутри

Модуль «Мониторинг соцсетей» в полном составе:

- источники (свои страницы + внешние/чужие через search-index/Apify,
  provider API, browser capture), включая **скраппинг комментариев** под
  найденными постами (`searchIndex.includeComments`);
- сценарии, AI-триаж, AI-ответы и персона агента;
- юр. досье («Юр. кейсы»): пометка нарушений (оскорбление / клевета /
  бездоказательное обвинение / угроза), отчёты за период, AI-черновик
  письма-обращения + приложение с доказательствами, печать.

## Провижининг + перенос настроек

Скрипт `scripts/seeds/brandprotection.mjs`. Идемпотентен: повторный запуск
доклонирует только отсутствующее, ничего не перезаписывает.

```bash
# на зарегистрированном shared production host из clients/registry.json:
cd /opt/leaddrive-v2
CONFIRM_PROD=1 SEED_PASSWORD="$BRANDPROTECTION_SEED_PASSWORD" node scripts/seeds/brandprotection.mjs \
  --from=leaddrive \
  --email=admin@brandprotection.leaddrivecrm.org \
  --brand-protection-only=1
```

Флаги:

| Флаг | Смысл | По умолчанию |
|---|---|---|
| `--from=<slug>` | исходный тенант, откуда копируются настройки | обязателен |
| `--slug=` | slug нового тенанта | `brandprotection` |
| `--name=` | название организации | `Brand Protection` |
| `--email=` | админ нового тенанта | `admin@brandprotection.leaddrivecrm.org` |
| `SEED_PASSWORD` | сильный пароль из одобренного secret manager; в argv/документы не передавать | обязателен |
| `--brand-protection-only=1\|0` | принудительно вкл/выкл режим «только защита бренда» (без своих каналов/ответов). Без флага — наследуется от источника | наследуется |

Требования: `DATABASE_URL` и **`NEXTAUTH_SECRET` того же деплоя** — скрипт
пере-шифровывает токены, ключи выводятся из этого секрета. `scripts/` не
синкается CI — при запуске на сервере сначала скопировать файл.

### Что копируется

- фичефлаги соц-модуля (`ai_auto_social_reply[/shadow]`,
  `ai_auto_social_triage_shadow`, `social_brand_protection_only`);
- ChannelConfig «Monitoring providers» (Apify/search-index; токен
  пере-шифровывается под новый org id) и «Monitoring scenarios»
  (id сценариев сохраняются — ссылки из источников остаются валидными);
- персона социального AI-агента (`AiAgentConfig agentType="social"`);
- `SocialAccount` вместе с OAuth-токенами (их шифрование привязано к id
  страницы платформы, не к организации — переносимы);
- настройки каналов ответа (`SocialReplyChannelSetting`, идентичности
  переуказываются на клонированные аккаунты);
- `MonitoringSource` (привязка к аккаунту переуказывается; per-source
  токены search-index/provider пере-шифровываются под новые id);
- `ReplyPolicy`.

### Что НЕ копируется (сознательно)

- история упоминаний, доказательства, кластеры, юр. отчёты — только настройки;
- WhatsApp ChannelConfig (одна WABA в двух тенантах = двойная обработка
  вебхуков) — при необходимости подключить канал в новом тенанте заново;
- пользователи, кроме создаваемого админа.

Если какой-то токен не удалось расшифровать известными purpose-строками,
скрипт НЕ падает: печатает warning, а токен нужно будет переподключить
в UI нового тенанта.

## DNS / nginx / TLS

Ничего настраивать НЕ нужно, если wildcard уже работает (проверено
2026-07-08: `*.leaddrivecrm.org` резолвится wildcard-записью за Cloudflare —
как zeytunpharm/afigroup/mars, новый сабдомен подхватывается сразу).
Роутинг тенанта делает middleware приложения по slug из Host.

Проверка: `curl -I https://brandprotection.leaddrivecrm.org/api/v1/ping`.
Только если ответа нет — значит origin-nginx не ловит этот сабдомен, тогда:
конфиг из `clients/nginx/template.conf` (`{{DOMAIN}}=brandprotection.leaddrivecrm.org`,
`{{PORT}}=3001`), symlink в `sites-enabled/`, `nginx -t && systemctl reload nginx`
(TLS до origin терминирует Cloudflare — certbot нужен только при Full(strict)
с per-host сертификатами).

## Проверка после переноса

1. Логин: `https://brandprotection.leaddrivecrm.org` под админом.
2. `/api/v1/ping` — smoke.
3. Мониторинг соцсетей → «Источники»: список совпадает с исходным тенантом,
   readiness-шаги зелёные (токены расшифровались).
4. «Настройки» watchlist: провайдер search-index виден, тумблер комментариев
   в нужном положении; прогнать один источник вручную («Run now»).
5. Сценарии и AI-агент на месте; «Юр. кейсы» — вкладка открывается.
6. Cron поллинга (`/api/cron/social-monitoring-sources`, `/api/cron/social-poll`)
   общий для инстанса — отдельной настройки не требует.
