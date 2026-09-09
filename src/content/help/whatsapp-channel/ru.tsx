"use client"

/**
 * Канал WhatsApp Business — справочная статья (русский).
 * Охватывает только Настройки → Каналы → WhatsApp: проверку подключения,
 * webhook URL, привязку шаблонов автоматических уведомлений и синхронизацию
 * шаблонов из Meta. Заполнение самих данных доступа (/settings/channels) НЕ
 * охватывается — эта страница только для чтения + проверки + синхронизации.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function WhatsappChannelHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Вы администратор поддержки или маркетинга"
        goal="Проверить, что подключение WhatsApp Business работает, подтянуть одобренные Meta шаблоны и настроить, какой шаблон автоматически отправляется при каком системном событии"
      >
        На страницу вы попадаете через <HelpKey>Настройки</HelpKey> → <HelpKey>Каналы</HelpKey> →{" "}
        <HelpKey>WhatsApp Business</HelpKey>. Всё здесь — данные доступа, шаблоны и привязки уведомлений —
        ограничено вашей организацией (тенантом): свой WABA, свой номер, свои одобренные шаблоны.{" "}
        <strong>Важно:</strong> эта страница <strong>не создаёт</strong> шаблоны и{" "}
        <strong>не заполняет</strong> данные доступа — шаблоны создаются и проходят модерацию в Meta
        Business Manager, а данные доступа вводятся на экране <HelpKey>Настройки</HelpKey> →{" "}
        <HelpKey>Каналы</HelpKey>. Здесь вы только <strong>проверяете, синхронизируете и
        привязываете</strong>.
        Эта страница проверяет messaging. WhatsApp Business Calling использует тот же Meta app и
        номер, но подписка calls events и call controls в Inbox готовятся через чеклист{" "}
        <HelpKey>WhatsApp Business Calling</HelpKey> в <HelpKey>Настройки → Каналы</HelpKey>.
        <HelpKey>Настройки → VoIP</HelpKey> используйте только для обычных провайдеров: Twilio, 3CX,
        Asterisk или SIP.
      </HelpScenario>

      <HelpSection title="Что есть на странице">
        <p>
          В заголовке зелёная иконка сообщения рядом с названием <HelpKey>WhatsApp Business</HelpKey> и
          короткое описание под ним. Ниже сверху вниз идут четыре карточки:{" "}
          <strong>Проверка подключения</strong>, <strong>Webhook URL</strong>,{" "}
          <strong>Автоматические уведомления</strong> и <strong>Шаблоны</strong>. Если канал ещё не
          настроен, в нескольких местах появляются жёлтые полосы-предупреждения, а часть кнопок
          остаётся неактивной.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Данные доступа">
            Ключи подключения WhatsApp — access token и phone number ID. На этой странице они только
            проверяются; вводятся на экране <HelpKey>Настройки</HelpKey> → <HelpKey>Каналы</HelpKey>.
          </HelpDef>
          <HelpDef term="Verified name">
            Официальное имя, которое Meta одобрила для вашего профиля WhatsApp Business — возвращается
            при успешной проверке.
          </HelpDef>
          <HelpDef term="Webhook URL">
            Адрес, по которому Meta доставляет вам входящие сообщения. Его нужно вставить в Meta Business
            Manager.
          </HelpDef>
          <HelpDef term="Шаблон (template)">
            Готовая, одобренная Meta форма сообщения. Вне 24-часового сервисного окна написать клиенту
            можно только одобренным шаблоном.
          </HelpDef>
          <HelpDef term="Approved (одобренный)">
            Статус шаблона, означающий, что Meta его промодерировала. Только <strong>approved</strong>{" "}
            шаблоны можно выбрать в выпадающих списках автоматических уведомлений.
          </HelpDef>
          <HelpDef term="24-часовое сервисное окно">
            24 часа после последнего сообщения клиента — в этот период можно слать свободный текст;
            после него работает только одобренный шаблон.
          </HelpDef>
          <HelpDef term="WhatsApp-звонки">
            WhatsApp Business Calling готовится отдельно от этой messaging-страницы. Сохраните
            WhatsApp Business API credentials, подпишите Meta webhook на calls events на
            app.leaddrivecrm.org и проверьте один контролируемый входящий звонок в Inbox.
          </HelpDef>
        </dl>
        <p>
          В карточке <strong>Проверка подключения</strong> видно, настроен ли канал, и если да — verified
          name, Phone ID и время последней проверки; справа кнопки <HelpKey>Изменить данные доступа</HelpKey> и{" "}
          <HelpKey>Проверить</HelpKey>. В карточке <strong>Webhook URL</strong> показан копируемый адрес.
          В карточке <strong>Автоматические уведомления</strong> — выбор шаблонов по статусам тикетов,
          шаблоны опроса и journey, и кнопка <HelpKey>Сохранить</HelpKey>. В карточке{" "}
          <strong>Шаблоны</strong> — список шаблонов, подтянутых из Meta, и кнопка{" "}
          <HelpKey>Синхронизировать с Meta</HelpKey>.
        </p>
      </HelpSection>

      <HelpSection title="Шаг за шагом: проверьте подключение">
        <HelpStep n={1}>
          <p>
            Посмотрите на карточку <strong>Проверка подключения</strong>. Мелкий текст под ней
            показывает статус канала — если настроен, то verified name, Phone ID и время последней
            проверки; если нет — предупреждение «WhatsApp не настроен».
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Если канал не настроен, жёлтым выводится «WhatsApp не настроен — заполните данные доступа в
            /settings/channels». Если настроен, серым показывается «Настроен: &lt;имя&gt;», «Phone
            ID: …» и «Последняя проверка: …».
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Нажмите кнопку <HelpKey>Проверить</HelpKey> справа вверху. (Чтобы изменить access token или
            номер, соседняя <HelpKey>Изменить данные доступа</HelpKey> ведёт на <HelpKey>Настройки</HelpKey> →{" "}
            <HelpKey>Каналы</HelpKey>.)
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Во время проверки кнопка меняется на «Проверяется…». При успехе ниже появляется зелёная
            полоса: «Verified: &lt;имя&gt;» и «Phone: &lt;номер&gt;». При неудаче в красной полосе
            выводится текст ошибки от Meta.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: подключите webhook URL к Meta">
        <HelpStep n={1}>
          <p>
            В карточке <strong>Webhook URL</strong> нажмите кнопку копирования (иконка-документ) рядом с
            показанным адресом.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            URL показан моноширинным текстом и включает slug вашей организации
            (напр. «…/api/v1/webhooks/whatsapp?t=&lt;tenant&gt;»). После копирования иконка на кнопке
            ненадолго превращается в зелёную галочку.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Откройте ссылку <HelpKey>developers.facebook.com</HelpKey> из описания карточки и оттуда
            вставьте скопированный URL в разделе WhatsApp → Configuration → Webhook. Verify token
            задайте тот же, что в настройках канала.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Ссылка открывает панель разработчика Meta в новой вкладке. В описании указано, где задаётся
            Verify token, с пометкой «(см. /settings/channels)».
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: синхронизируйте шаблоны из Meta">
        <HelpStep n={1}>
          <p>
            Прокрутите к карточке <strong>Шаблоны</strong>. Нажмите кнопку{" "}
            <HelpKey>Синхронизировать с Meta</HelpKey> справа вверху.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Иконка круговой стрелки на кнопке начинает вращаться, текст меняется на «Синхронизируется…».
            По завершении появляется сообщение «Синхронизировано: N шаблонов», а счётчик в заголовке
            (<HelpKey>Шаблоны (N)</HelpKey>) обновляется. Время «Последняя синхронизация: …» под
            заголовком тоже обновляется.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Кликните по любой строке шаблона в списке, чтобы развернуть её.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            В каждой строке видны имя шаблона (моноширинно), язык, категория и значок статуса:{" "}
            <strong>approved</strong> (зелёный), <strong>pending</strong> (жёлтый),{" "}
            <strong>rejected</strong> (красный), <strong>disabled</strong> (серый) или{" "}
            <strong>paused</strong> (синий). Если есть переменные, появляется пометка «N переменных».
            При разворачивании показываются текст Header, Body, Footer, список переменных ({"{{...}}"})
            и кнопки в виде JSON, если они есть.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Если шаблонов ещё нет, в карточке показывается пустое состояние.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Появляется заголовок «Шаблонов пока нет» и подсказка под ним: «Создайте шаблоны в Meta
            Business Manager, потом нажмите “Синхронизировать с Meta”».
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: настройте автоматические уведомления">
        <HelpStep n={1}>
          <p>
            Перейдите к карточке <strong>Автоматические уведомления</strong>. В разделе{" "}
            <strong>Уведомления при смене статуса тикета</strong> выберите одобренный шаблон из
            выпадающего списка напротив каждого статуса (напр. <HelpKey>new</HelpKey>,{" "}
            <HelpKey>open</HelpKey>, <HelpKey>resolved</HelpKey>).
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            В каждой строке слева значок статуса, справа выпадающий список. В списке только{" "}
            <strong>approved</strong> шаблоны в формате «имя (язык)», а сверху — пункт «— не слать —».
            Если для статуса оставить «— не слать —», уведомление по этому статусу не отправляется.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            В двух выпадающих списках ниже при необходимости выберите <strong>шаблон приглашения на
            опрос</strong> (отправляется, когда survey-trigger срабатывает с каналом WhatsApp) и{" "}
            <strong>шаблон по умолчанию для journey</strong> (fallback для шага send_whatsapp, если сам
            шаг не указывает шаблон).
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Под каждым есть короткое пояснение, когда он используется. Эти списки тоже показывают только
            одобренные шаблоны плюс пункт «— не слать —» сверху.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Нажмите кнопку <HelpKey>Сохранить</HelpKey> справа вверху.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Кнопка меняется на «Сохраняется...», затем ненадолго показывает подтверждение «Сохранено»,
            которое исчезает через несколько секунд. Если канал ещё не настроен, кнопка{" "}
            <HelpKey>Сохранить</HelpKey> и все выпадающие списки остаются неактивными.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">
        <p>
          В выпадающих списках автоматических уведомлений показываются только{" "}
          <strong>approved</strong> шаблоны. Если они пусты или вы видите сообщение «Нет approved
          шаблонов», сначала нажмите <HelpKey>Синхронизировать с Meta</HelpKey> — шаблоны становятся
          доступными для выбора после того, как подтянутся и получат статус approved.
        </p>
      </HelpCallout>

      <HelpCallout kind="warning">
        <p>
          Если для статуса (или поля опроса/journey) оставить «— не слать —», по этому событию WhatsApp-
          уведомление <strong>вообще не отправляется</strong> — это не ошибка, и клиент ничего не видит.
          Чтобы уведомление действительно отправлялось, нужно выбрать одобренный шаблон и подтвердить
          кнопкой <HelpKey>Сохранить</HelpKey>.
        </p>
      </HelpCallout>

      <HelpCallout kind="security">
        <p>
          Все данные доступа, шаблоны и привязки уведомлений ограничены вашей организацией — вы не видите и
          не можете менять конфигурацию WhatsApp другого тенанта. Webhook URL несёт slug вашей
          организации, поэтому входящие сообщения попадают в правильный тенант. Сам access token на этой
          странице не показывается — он только проверяется.
        </p>
      </HelpCallout>
    </div>
  )
}
