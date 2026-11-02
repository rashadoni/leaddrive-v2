# LeadDrive e-Qaimə — публикация в Chrome Web Store

Расширение `extensions/e-qaime/` (вкладка «Финансы → E-qaimə»). Пакет для
загрузки — `public/downloads/leaddrive-e-qaime.zip` (собирается
`node scripts/e-qaime-extension/pack.mjs`, тест `e-qaime-extension.test.ts`
сверяет его с исходниками). Картинки для карточки — `extensions/e-qaime-store/`.

## Что делает владелец (только он: аккаунт и оплата)

1. Открыть https://chrome.google.com/webstore/devconsole под Google-аккаунтом
   компании (лучше общий рабочий, а не личный: к нему будет привязано
   расширение навсегда).
2. Принять соглашение разработчика и оплатить регистрацию — разово 5 $.
3. Подтвердить e-mail для связи.
4. Указать статус «Торговец» (trader) и данные FANUM MMC: адрес
   «Abbasqulu Abbaszadə 13/5, AZ1073, Baku, Azerbaijan», телефон, e-mail.
   Магазин подтверждает телефон и e-mail кодом.
5. Дальше — либо загрузить всё по разделу ниже самому, либо войти в devconsole в
   своём Chrome и дать сессии заполнить карточку. Кнопку «Отправить на проверку»
   нажимает владелец.
6. После одобрения (обычно от нескольких часов до нескольких дней) прислать
   ссылку на страницу расширения в магазине. Сессия впишет её в
   `E_QAIME_STORE_URL` (`src/components/finance/e-qaime-dashboard.tsx`), и
   кнопка «Установить расширение» поведёт в магазин вместо zip.

## Карточка: что куда вписать

**Пакет:** `public/downloads/leaddrive-e-qaime.zip` (версия 1.0.1).

**Название:** LeadDrive e-Qaimə (берётся из манифеста).

**Краткое описание** (из манифеста, 71 знак):
e-Taxes-dəki elektron qaimələri LeadDrive-a gətirir: Maliyyə → E-qaimə.

**Категория:** Productivity → Workflow & Planning. **Язык:** azərbaycan.

**Описание:**

> LeadDrive e-Qaimə e-Taxes portalındakı (new.e-taxes.gov.az) elektron
> qaimə-fakturaları LeadDrive CRM-ə gətirir.
>
> • Gələn və göndərilən e-qaimələr seçdiyiniz dövr üzrə bir kliklə yüklənir
> • Hər qaimənin PDF-i portalın çap etdiyi kimi saxlanılır
> • «Maliyyə → E-qaimə» bölməsində: siyahı, ƏDV-siz məbləğ, ƏDV, cəmi, statuslar
> • Bütün mallar bir Excel faylında — hər mal ayrıca sətirdə
> • Qarşı tərəf VÖEN üzrə LeadDrive-dakı şirkətə bağlanır
> • Təkrar yükləmədə yalnız yeni və statusu dəyişmiş qaimələr açılır
>
> Şifrə istəmir: e-Taxes-ə ASAN İmza ilə özünüz daxil olursunuz, portalın
> giriş icazəsi brauzerinizdən çıxmır. Məlumatlar yalnız sizin LeadDrive iş
> sahənizə gedir.
>
> LeadDrive CRM hesabı və «Maliyyə» modulu tələb olunur (admin və ya menecer rolu).
>
> —
>
> Расширение переносит электронные счета-фактуры (e-qaimə) из налогового
> портала new.e-taxes.gov.az в LeadDrive CRM: входящие и исходящие за период,
> PDF, Excel со всеми товарами. Пароль не нужен — в e-Taxes вы входите сами,
> пропуск портала не покидает ваш браузер. Нужен аккаунт LeadDrive с модулем
> «Финансы».
>
> Brings the electronic invoices (e-qaimə) from the Azerbaijani tax portal
> new.e-taxes.gov.az into LeadDrive CRM: incoming and outgoing for a period,
> PDFs, and an Excel file with every product. No password needed — you sign in
> to e-Taxes yourself, and the portal's pass never leaves your browser.
> Requires a LeadDrive account with the Finance module.

**Картинки** (`extensions/e-qaime-store/`):
- значок 128×128 — `icon-128x128.png`;
- снимки 1280×800 — `screenshot-1-finance-tab-1280x800.png`,
  `screenshot-2-panel-1280x800.png` (данные на них вымышленные);
- малая промо-плитка 440×280 — `promo-small-440x280.png`.

**Сайт:** https://leaddrivecrm.org. **Поддержка:** e-mail поддержки LeadDrive.

## Вкладка «Конфиденциальность»

**Единственное назначение:** Bring the electronic invoices (e-qaimə) of the
company the user has signed in to on the Azerbaijani tax portal
new.e-taxes.gov.az into that user's LeadDrive CRM workspace.

**Обоснование разрешений:**
- `storage` — remembers the LeadDrive address (tenant subdomain) the user works
  at, and a short-lived flag set by the «Refresh from e-Taxes» button in
  LeadDrive so that reading starts after the user signs in to the portal.
- `https://new.e-taxes.gov.az/*` — reads the invoice list, the invoice cards and
  their PDFs of the signed-in company, the same requests the portal's own pages
  make, and shows the extension's panel on the portal.
- `https://*.leaddrivecrm.org/*` — sends the invoices to the user's own
  LeadDrive workspace under their LeadDrive session (each customer works at
  their own subdomain), and marks LeadDrive pages so the Finance tab knows the
  extension is installed.

**Удалённый код:** нет (весь код в пакете, `eval` и внешних скриптов нет).

**Какие данные (отметить):**
- Финансовая и платёжная информация — счета-фактуры, суммы, налоги;
- Персональные данные — имена и VÖEN контрагентов-ИП, имя вошедшего ИП;
- Данные аутентификации — пропуск портала читается из страницы портала для
  запросов к нему же; он не передаётся никуда, но расширение с ним работает;
- Содержимое сайтов — ответы портала налоговой.

**Подтверждения (все три отметить):** данные не продаются третьим лицам; не
используются вне единственного назначения; не используются для оценки
кредитоспособности.

**Политика конфиденциальности:**
https://app.leaddrivecrm.org/legal/privacy#e-qaime-extension
(раздел 10; выкатывается вместе с этой подготовкой — проверить, что открывается,
до отправки).

## Видимость

Рекомендация на старт — **«По ссылке» (Unlisted)**: ставят только те, кому дали
ссылку (кнопка во вкладке LeadDrive), расширение не всплывает в поиске
магазина у случайных людей. Перевести в «Публично» можно в любой момент без
новой проверки пакета.

## После публикации

- Тем, кто ставил zip вручную, удалить старую копию в `chrome://extensions` и
  поставить из магазина — иначе будет две.
- Новая версия: поднять `version` в манифесте, `pack.mjs`, загрузить zip в
  devconsole → «Отправить на проверку». Магазин обновит у всех сам.
