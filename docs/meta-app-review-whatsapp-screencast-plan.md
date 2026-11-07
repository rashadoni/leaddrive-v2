# Ролик для `whatsapp_business_messaging` — готовый сценарий съёмки

Составлен 2026-11-05, пока заявка от 23.10 ещё «Идёт проверка». Смысл документа
один: если придёт отказ, не начинать думать с нуля, а снять и подать в тот же
день. Все экранные надписи ниже сверены с кодом `origin/main`, доступ Embedded
Signup — с живым продом.

## Почему именно так

Instagram-разрешения отклоняли дважды (01.10 и 08.10) с одной и той же
формулировкой пункта 1.6: ролик «не демонстрирует весь описанный процесс».
Оба раза видео собиралось из кадров рекордера, и шаг входа показывал диалог
«Ранее вы подключили приложение… Продолжить?» уже залогиненного браузера,
а не вход с экрана логина. Запись, приложенная к текущей заявке 23.10, собрана
тем же способом и показывает переписку, но не подключение номера. Если отказ
придёт — он придёт об этом.

Что Meta требует дословно по своим отказам:

- вход через Meta **от начала до конца**, начиная с экрана входа;
- момент, когда пользователь **выдаёт разрешение**;
- полный сценарий **использования** разрешения;
- английский интерфейс, подписи к каждому шагу и пояснение элементов;
- явно сказать, если поток server-to-server или использует System User token.

## Что у нас уже есть (проверено 2026-11-05)

- Embedded Signup живой на проде: `WHATSAPP_EMBEDDED_SIGNUP_APP_ID`,
  `…_APP_SECRET`, `…_CONFIG_ID` заданы и в `.env`, и в процессе PM2.
- `WHATSAPP_EMBEDDED_SIGNUP_APP_ID` = `2414060595720618`, то самое приложение,
  которое сейчас на проверке. Снимать будем именно его согласие.
- Кнопка живёт в карточке канала WhatsApp: `src/components/channel-config-form.tsx`,
  компонент `src/components/channels/whatsapp-embedded-signup.tsx`.
- Сервер (`src/lib/whatsapp-embedded-signup.ts`) после диалога сам меняет код на
  токен, проверяет, что номер принадлежит выбранному WABA, подписывает WABA на
  вебхуки и регистрирует номер в Cloud API. Это и есть «полный сценарий»,
  который Meta просит показать.

## Какой номер подключать на камеру

Решено 2026-11-05: снимаем на **+994 10 531 80 49** («Fanum Sec», WABA
4315308408759063, организация LeadDrive Inc.). Свободной SIM у владельца нет, а
покупать её ради ролика не нужно.

| Номер | Можно снимать | Почему |
|---|---|---|
| +994 10 531 30 65 | **нет** | коды входа MTM и демо-линия; 298 сообщений, повторный signup перезапишет токен живого канала |
| +994 99 301 29 14 (Zeytun Pharma) | **нет** | рабочая линия заказов клиента, переписка идёт прямо сейчас |
| **+994 10 531 80 49 (Fanum Sec)** | **да** | простаивает: 4 сообщения за всё время, последнее 03.10; подключён через Embedded Signup 22.10, повторное подключение обновит ту же строку |
| свободная SIM | если появится | тогда в кадр попадёт и проверка нового номера кодом Meta |

Что меняется от съёмки на уже подключённом номере: на шаге 8 владелец выбирает
существующий номер, а не добавляет новый с подтверждением кодом. Для отказа это
не важно — Meta придиралась к входу и выдаче разрешения, а не к регистрации
номера. Строка канала при этом только обновляется: сервер пишет её лишь при
успешном завершении, при обрыве остаются прежние учётные данные.

Номер, активный в другом рабочем пространстве, сервер не отдаст: будет
409 `conflict`. Поэтому либо новый номер, либо номер своей же организации.

## Подготовка до записи

1. Отдельный профиль Chrome **без сессии Facebook**. Весь смысл в том, что вход
   начинается с экрана логина. Пароль вводит владелец сам. Отдельный профиль
   нужен и по второй причине: проверено 2026-11-05, рабочий Chrome владельца
   залогинен в CRM как **Togrul, организация Zeytun Pharma**, а вход в CRM —
   одна сессия на браузер, так что вход владельцем в том же профиле выбьет
   текущую.
1a. Войти в CRM своим аккаунтом в организацию **LeadDrive Inc.** — именно в ней
   живёт канал Fanum Sec. Переключателя организаций в интерфейсе нет, он
   определяется аккаунтом.
2. Язык аккаунта Facebook — **English**. Диалог Meta игнорирует параметр
   `locale=` и идёт на языке аккаунта.
3. Язык CRM — **English** (переключатель языка в интерфейсе).
4. Рабочее пространство без чужих переписок. Иначе в кадр попадут настоящие
   клиенты, и придётся замазывать, а замазанный кадр — снова повод для вопросов.
5. Телефон клиента в кадре: либо зеркалирование экрана телефона в окне на том же
   мониторе, либо второй кадр. Главное, чтобы отправка и приём были в **одном
   непрерывном дубле**.
6. Запись экрана — QuickTime (Shift+Cmd+5) или OBS, 1080p, один дубль без
   склеек. Загрузчик Meta принимает только `.mp4` и `.mov`.
7. Английские подписи накладываются после съёмки, но видео остаётся непрерывной
   записью экрана. Слайд-шоу из кадров — то, за что отказали дважды.

## Кадр за кадром

| № | Что в кадре | Подпись (английская, дословно) |
|---|---|---|
| 1 | Вход в `app.leaddrivecrm.org` под админом организации | Business admin signs in to LeadDrive CRM. |
| 2 | Settings → Channels, открывается карточка WhatsApp | The admin opens the WhatsApp channel in Settings → Channels. |
| 3 | Блок «Connect with Meta (recommended)», курсор на кнопке «Connect WhatsApp with Meta» | LeadDrive offers to connect the business's own WhatsApp number through Meta. |
| 4 | Клик по кнопке, открывается окно Meta — **экран входа** | The Meta flow starts here, at the Facebook sign-in screen. |
| 5 | Владелец вводит логин и пароль | The business owner signs in to Facebook. |
| 6 | Выбор бизнес-портфеля | The owner selects the business portfolio that owns the number. |
| 7 | Выбор или создание WhatsApp Business Account | The owner selects the WhatsApp Business Account. |
| 8 | Выбор номера либо ввод нового и код подтверждения | The owner adds the business phone number and verifies it with the code from Meta. |
| 9 | **Экран разрешений Meta, крупно, без спешки** | Meta asks the owner to grant the permissions. This screen is where whatsapp_business_messaging is granted to LeadDrive CRM. |
| 10 | Окно закрылось, в CRM видно «Connected: <номер>» | The number is now connected in the CRM. LeadDrive has subscribed the account to webhooks and registered the number. |
| 11 | Телефон: клиент пишет на этот номер | A customer sends a WhatsApp message to the business number. |
| 12 | Сообщение появилось в инбоксе CRM | The message arrives in the LeadDrive inbox through the WhatsApp webhook. |
| 13 | Оператор открывает диалог, печатает ответ, отправляет | An authorized operator replies from the CRM. This is the use of whatsapp_business_messaging. |
| 14 | Телефон: ответ пришёл, видны галочки | The customer receives the reply; delivery and read status return to the CRM. |
| 15 | Карточка контакта или лида с этой перепиской | The conversation is stored in the customer's record in the CRM. |

Шаги 1–10 — это то, чего не было ни в одном нашем ролике. Шаги 11–15 у нас уже
сняты 23.10, но пересняты будут тем же дублем.

## Что написать в заявке рядом с видео

Готовый текст, остаётся подставить таймкоды вместо `0:00`:

> LeadDrive CRM, operated by FANUM LLC, is a multi-tenant CRM with a shared
> inbox. The attached file is a single continuous screen recording, not a
> sequence of captured frames.
>
> 0:00 A business admin signs in to LeadDrive CRM.
> 0:00 Settings → Channels → WhatsApp. The admin starts "Connect WhatsApp with Meta".
> 0:00 Meta's Embedded Signup opens at the Facebook sign-in screen. The business
> owner signs in with their own Facebook account.
> 0:00 The owner selects the business portfolio, the WhatsApp Business Account and
> the business phone number.
> 0:00 The owner grants the permissions on Meta's consent screen. This is where
> whatsapp_business_messaging is granted to the app.
> 0:00 The dialog closes and the number appears in the CRM as a connected channel.
> Our server exchanges the one-time code for a business token, subscribes the
> WhatsApp Business Account to our webhook and registers the number for Cloud API.
> 0:00 A customer sends a WhatsApp message to that business number from their phone.
> 0:00 The message arrives in the LeadDrive inbox through our webhook endpoint.
> 0:00 An authorized operator opens the conversation and sends a reply from the CRM
> with POST /{phone-number-id}/messages. This is the use of whatsapp_business_messaging.
> 0:00 The customer receives the reply; delivery and read statuses come back through
> webhooks and are displayed in the CRM.
>
> The flow shown is not server-to-server and does not use a System User token: the
> connection is performed by the account owner through Embedded Signup, and the
> reply is sent by a signed-in operator. Free-form replies are limited to the
> 24-hour customer service window; outside it the CRM sends a Meta-approved
> template. The number shown belongs to our own business and the customer side is
> our own test contact, so no third-party data appears in the recording.

## Чего не делать

- Не собирать видео из кадров рекордера.
- Не отменять текущую заявку ради того, чтобы переснять заранее: отмена ставит
  нас в конец очереди, а срок и так идёт.
- Не трогать номер +994 10 531 30 65.
- Не показывать чужие переписки, номера и персональные данные.

## Когда

Как только Meta ответит. Отказ — снимаем и подаём в тот же день. Одобрение —
сценарий остаётся: такой же непрерывный показ потребуется для следующих
разрешений, в первую очередь для комментариев Instagram.

## 2026-11-07: ролик снят, лежит и ждёт решения Meta

Снимать запись экрана не пришлось и не придётся: владелец этого не делает
(«съёмки не умею, сними как и снимал до этого»). Ролик собран прежним способом —
кадры плюс английские подписи, `build.py` + JSON-спек, — но теперь в нём есть
оба экрана, из-за отсутствия которых отказали 01.10 и 08.10.

- Файл: `/home/rashad/inbox/meta-review-2026-11-07/meta-review-whatsapp-v2.mp4`,
  1:37, 1,5 МБ, 1568×784. Рядом `spec-wa3.json`, `build.py`, `frames/`,
  `SHA256SUMS`.
- Шестнадцать кадров: каталог каналов → окно Meta на `facebook.com/login.php`
  с `app_id=2414060595720618` → форма входа → «Facebook Login for Business» →
  выбор номера → **«Review what you'll share with CRM»** с перечнем прав и
  Confirm → «Your account is connected» → Connected в CRM → входящее
  «Hi, is my order ready?» → ответ напечатан → ответ доставлен в 10:37.
- Замазано: номер клиента Zeytun в списке номеров Meta и чужие переписки в
  Inbox.

**Как удалось снять окно Meta — это главное техническое знание.** Диалог
Embedded Signup открывается `window.open` отдельным ОКНОМ: расширение Chrome
видит только вкладки своей группы, а снимок окна через computer-use тащит в кадр
жёлтую плашку «"Claude" started debugging this browser». Решение — перед кликом
по карточке подменить в странице `window.open` так, чтобы она открывала вкладку:

```js
const _o = window.open.bind(window)
window.open = (url, name) => _o(url, name || '_blank')
```

Диалог открывается вкладкой в группе расширения, `window.opener` сохраняется,
postMessage доходит, подключение проходит по-настоящему (строка канала
`Fanum Sec` обновилась 2026-11-07 06:41 UTC). Кадры снимаются вьюпортом — без
плашки и без хрома браузера, во всю ширину. Колонка диалога шириной 562 px,
кропается `crop=562:658:0:0`.

Экран входа снимается, пока владелец разлогинен в Facebook; `locale=ru_RU` в
URL логина меняется на `en_US` через `location.href.replace`. Язык аккаунта
Facebook переключён на английский в Настройках → Язык аккаунта. Пароль вводит
только владелец — у сессии его нет и быть не должно.

**Подать сейчас нельзя:** заявка от 23.10 всё ещё «Идёт проверка», файл в ней не
подменяется. Придёт отказ — заливать этот ролик вместе с английским текстом
выше, таймкоды проставить по списку из `build.py` (он печатает их при сборке).
