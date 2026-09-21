# Omni-channel Inbox — рекламный ролик (по образцу WhatChimp), az-озвучка

Образец: facebook.com/whatchimp/videos/28102737939367195 — 35 с, квадрат, макет
инбокса, текст на экране, звук не обязателен. Формула: боль ночью → ИИ отвечает →
человек подхватывает сложное → утро, всё закрыто → каналы → CTA.

Наш ролик — та же формула, но **каждый кадр = реальный модуль на демо-тенанте**
(`leaddrive`), локаль `az`, голос Gemini `Kore`, вшитые az-субтитры (лента
играет без звука). Формат: 1080×1080 (лента FB/IG) + 1080×1920 (Reels/Stories)
из одного сценария. Длина ~38–42 с по az-озвучке.

## Раскадровка

| # | Сек | Экран (реальный модуль) | Курсор / действие | Текст на экране (az) | Озвучка (az) | Перевод (ru) |
|---|---|---|---|---|---|---|
| 1 | 0–5 | `/inbox`, затемнён на 60 %, поверх — карточка-хук | — | **Gecə 2:14. Müştəri yazır.** / *Kim cavab verir?* | Gecə saat ikidir. Müştəri yazır: «Kimsə var?» Kim cavab verir? | Два часа ночи. Клиент пишет: «Есть кто-нибудь?» Кто отвечает? |
| 2 | 5–11 | `/inbox` — список «Gələnlər», открыт тред WhatsApp/Telegram; панель **AI cavab təklifi** | Курсор на реплику клиента → на панель AI-ответа → на кнопку вставить | **AI cavab təklifi** — cavab 4 saniyəyə | LeadDrive-da süni intellekt cavabı hazırlayır: müştərinin sualına saniyələr içində, sizin bilik bazanızdan. | В LeadDrive ответ готовит ИИ: на вопрос клиента — за секунды, из вашей базы знаний. |
| 3 | 11–16 | `/inbox/chatbot-rules` — экран «Çatbot avtomatik cavab», тумблер **AKTİVDİR**, список правил | Курсор на статус «AKTİVDİR» → на правило | **Avtomatik cavab: AKTİV** / 24/7 | Gecə də, bayramda da — avtomatik cavablar işləyir, müştəri gözləmir. | И ночью, и в праздники — автоответы работают, клиент не ждёт. |
| 4 | 16–23 | `/inbox` — тред; кнопка **Təyin et**, затем **Lidə çevir → Lid yarat və satıcı təyin et** | Клик **Təyin et** → выбор сотрудника (не сохраняем) → курсор на **Lidə çevir** | **Çətin sualı komanda götürür** | Çətin sualı komanda götürür: bir kliklə əməkdaşa təyin edin, söhbəti lidə çevirin — satıcı artıq işə başlayır. | Сложный вопрос берёт команда: одним кликом назначаете сотрудника, превращаете чат в лид — продавец уже в работе. |
| 5 | 23–29 | `/inbox/analytics` — «Gələnlər analitikası»: **İlk cavab vaxtı**, статусы по каналам | Курсор на карточку «İlk cavab vaxtı» → на график по каналам | **Səhər 7:24. Hər söhbətə cavab verilib.** | Səhər açılır — hər söhbətə cavab verilib. İlk cavab vaxtı, həll olunan söhbətlər, kanallar üzrə yük — hamısı bir ekranda. | Утро — на каждый чат отвечено. Время первого ответа, решённые чаты, нагрузка по каналам — всё на одном экране. |
| 6 | 29–35 | `/inbox` — рейл **Kanallar**: WhatsApp · Telegram · Instagram · Facebook · TikTok · SMS · E-poçt · Veb-çat · VoIP | Курсор проходит по фильтрам каналов сверху вниз, на каждом — подсветка | **Bir gələnlər qutusu. Bütün kanallar.** | WhatsApp, Telegram, Instagram, Facebook, TikTok, SMS, e-poçt, saytdakı çat və zənglər — hamısı bir gələnlər qutusunda. | WhatsApp, Telegram, Instagram, Facebook, TikTok, SMS, почта, чат на сайте и звонки — всё в одном инбоксе. |
| 7 | 35–41 | Финальная карточка: логотип LeadDrive, подзаголовок, иконки каналов, кнопка CTA | — | **LeadDrive** / *Bir gələnlər qutusu. Bir AI.* / [CTA] / leaddrivecrm.org | LeadDrive. Bir gələnlər qutusu, bir süni intellekt. Bu gün başlayın. | LeadDrive. Один инбокс, один ИИ. Начните сегодня. |

Хронометраж — по az-озвучке; en/ru при необходимости получаются из тех же сцен
(рекордер держит сцену `max(действия, озвучка)`).

## Что переигрываем у образца

1. Реальный интерфейс вместо макета — все семь кадров сняты в продукте.
2. Голос + вшитые субтитры: у образца голоса нет, текста на экране мало.
3. Локальный хук и цифры из реального экрана аналитики (не «Replied in 4 seconds»
   из макета).
4. Без пустых кадров (у образца — 7-я и 22-я секунды), UI крупными кропами.
5. Два формата из одного прогона.

## Открытые решения владельца

- **CTA (кадр 7):** «Demo sifariş et» (заявка на демо) или «Pulsuz sınaq» —
  зависит от того, что реально предлагаем; в `docs/presentation-az.md` про триал
  неправда, источник истины — leaddrive-site.
- **Instagram / Facebook в кадре 6:** канал в продукте есть, но живые DM клиентов
  ждут App Review Meta. Показываем как возможность продукта или убираем из списка.

## Что нужно доделать в рекордере (`scripts/produce-guides.mjs`)

- Размер кадра из env: `GUIDE_VIDEO_W/H` (1080×1080 и 1080×1920) вместо
  захардкоженных 1280×720; тот же viewport.
- Хелпер `h.card({title, sub, dim})` — полноэкранная карточка поверх страницы
  (кадры 1 и 7) и подпись-плашка `h.caption(text)` для кадров 2–6; всё через
  инжект DOM, без правок продукта.
- Субтитры: рекордер уже знает offsets сцен — писать `.srt` и вшивать
  `-vf subtitles=` при муксе (флаг `GUIDE_BURN_SUBS=1`).
- Для 9:16 — CSS-зум на активную зону (тред/рейл), иначе четырёхзонный инбокс
  нечитаем в вертикали.

## Проверка перед сдачей

`silencedetect=noise=-40dB:d=2.5` → 0 пауз; `freezedetect=n=0.003:d=6` → 0
замерших кусков; контактный лист `fps=1/2,tile=5x4` — глазами: карточки читаемы,
UI активен, help-карточка скрыта, названия каналов совпадают со списком выше.
