# Handoff: рекламный ролик Omni-channel Inbox (az) — промт для новой сессии

Скопируй блок между `---` первым сообщением в новую сессию leaddrive-v2.

---

Задача: собрать рекламный ролик модуля **Omni-channel Inbox** LeadDrive по образцу
WhatChimp (facebook.com/whatchimp/videos/28102737939367195 — 35 с, квадрат,
формула «ночь → ИИ отвечает → команда подхватывает → утро всё закрыто → каналы →
CTA»), с озвучкой на азербайджанском и вшитыми az-субтитрами, **из реальных
экранов продукта на демо-тенанте**, не из макетов. Сценарий уже написан и
согласован по подходу — не переписывай, реализуй.

## Готовые артефакты (лежат в воркетри, НЕ в main)
- Сценарий (7 кадров, тайминг, экран, действие курсора, az-озвучка + ru-перевод,
  открытые решения, список доработок рекордера):
  `/home/rashad/projects/leaddrive-v2/.claude/worktrees/handoff-video-guides-e10e4d/docs/omnichannel-reel-scenario.md`
- Универсальный промт по видео-гайдам (пайплайн, правила, грабли):
  `/home/rashad/projects/leaddrive-v2/.claude/worktrees/handoff-video-guides-e10e4d/docs/VIDEO-GUIDES-PROMPT-GENERIC.md`
- Тот воркетри стоит на ИСТОРИИ ДО ПЕРЕПИСЫВАНИЯ 2026-09-11 (там данные клиентов)
  — **ничего оттуда не пушить**. Скопируй оба файла в канонический чекаут
  `/home/rashad/projects/leaddrive-v2` на свежую ветку от `origin/main`.

## Пайплайн (уже отлажен для help-гайдов, переиспользуй)
- Рекордер `scripts/produce-guides.mjs`: Playwright `recordVideo` + ffmpeg mux;
  логин по API `/api/auth/csrf` → `/api/auth/callback/credentials` (поля
  `email`, `password`, `organizationSlug`); видимый курсор; `GUIDE_CSS` прячет
  help-карточку `[data-help-video-widget]` и тур. Вызов:
  `node scripts/produce-guides.mjs https://app.leaddrivecrm.org az <slug>`;
  секции — через ПРОБЕЛ; `FORCE=1` перезаписать. Вывод `video/player/{slug}.az.VOICE.mp4`.
- Сценарии — `video/scenarios/overrides.mjs`: `{ route, title, scenes:[{ voice:{az,en,ru},
  do: async (p, lang, h) => {...} }] }`; хелперы `h.moveTo/hover/click/fill/sleep/holdUntil(доля)`.
  Биты только через `holdUntil` (0.3/0.6/0.85, последний ≤0.9), не через `sleep`.
  Образцы качества: ключи `deals`, `deal-detail`.
- TTS az → Google Gemini `gemini-2.5-flash-preview-tts`, голос **Kore**
  (`GEMINI_API_KEY`; ~100 запросов/день, ~1–2 запроса/мин; ротация ключей
  `GEMINI_API_KEY2…`). en/ru → Azure `en-US-JennyNeural` / `ru-RU-DmitryNeural`.
  Переопределение: `GEMINI_TTS_VOICE`, `GEMINI_TTS_MODEL`, `ENGINE_AZ=azure`
  (запасной az-голос `az-AZ-BabekNeural`). Локального TTS не делать.
- Ключи и логин демо: `/home/rashad/projects/leaddrive-v2/.env`
  (`GEMINI_API_KEY`, `AZURE_SPEECH_KEY/REGION`, `HELP_VIDEO_EMAIL/PASSWORD/ORG_SLUG`).
  Рекордер `.env` сам не читает: `set -a; . /home/rashad/projects/leaddrive-v2/.env; set +a`.
- В воркетри нет `node_modules` — симлинк на `/home/rashad/projects/leaddrive-v2/node_modules`
  (gitignored). Playwright 1.58 и chromium-1208 уже стоят. ffmpeg 6.1 есть.

## БЛОКЕР (проверено 2026-09-21)
Логин демо-пользователя из `.env` (gmail-аккаунт, слаг `leaddrive`) на проде
отклоняется: `302 /login?error=CredentialsSignin` для слагов `leaddrive`, `demo`,
`demo-company` и без слага. `.env` от 2 августа; после него прошли pentest-hardening
(#857) и «reset tenant administrator passwords» (#863, 16 авг) — почти наверняка
пароль ротирован. Чтение логов прода по SSH в auto-режиме режется классификатором
(«Production Reads») — не трать на это попытки. **Первым делом попроси владельца
дать рабочий пароль демо-пользователя (или сбросить его через admin)** и обнови
`HELP_VIDEO_PASSWORD` в `.env`. Без этого ни проба селекторов, ни запись невозможны.

## Порядок работы после разблокировки
1. Проба: логин → скриншоты `/inbox`, `/inbox/chatbot-rules`, `/inbox/analytics`
   в локали az при 1080×1080 — убедиться, что в демо есть переписки по нескольким
   каналам и панель «AI cavab təklifi»; при пустоте — засеять демо (`scripts/demo-fill.mjs`,
   только демо-тенант, `CONFIRM_PROD=1`).
2. Доработки рекордера (см. раздел в сценарии): размер кадра из env
   `GUIDE_VIDEO_W/H`; хелперы `h.card()` (полноэкранная карточка для кадров 1 и 7)
   и `h.caption()` (плашка для 2–6) через инжект DOM; генерация `.srt` из offsets
   сцен и `-vf subtitles=` при муксе (`GUIDE_BURN_SUBS=1`); для 9:16 — CSS-зум на
   активную зону.
3. Сцена `omnichannel-reel` в `overrides.mjs` по раскадровке; селекторы проверить
   живьём; в `do` никаких сохраняющих кликов (назначение сотрудника — открыть и
   отменить).
4. Запись az → проверка `silencedetect -40dB:d=2.5` (0 пауз) + `freezedetect
   n=0.003:d=6` (0 стопов) + контактный лист `fps=1/2,tile=5x4` глазами →
   починить → 1:1 и 9:16 → показать владельцу. Это маркетинг-ролик: в
   `video/player` и в манифест help-видео НЕ класть; результат — файл владельцу.
5. Публикация куда-либо — только по «ок» владельца.

## Открытые решения владельца (спросить по одному)
- CTA финального кадра: «Demo sifariş et» или «Pulsuz sınaq» — что реально
  предлагаем (правда в leaddrive-site, не в docs/presentation-az.md).
- Instagram/Facebook в кадре каналов: показывать как возможность или убрать —
  живые DM ждут App Review Meta.

Правила: работать автономно, не отчитываться после каждого шага; вопросы —
строго по одному; никаких безлимитных `/loop` на дорогой модели; тяжёлое
(полные сборки, E2E) на Contabo не запускать — запись одного 40-секундного
ролика тяжёлым не считается.

---
