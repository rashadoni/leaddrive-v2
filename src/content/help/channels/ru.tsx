"use client"

/**
 * Communication Channels — help article (Russian).
 * Синхронизировано с каталогом Настройки → Каналы.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function ChannelsHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Вы администратор, который настраивает omni-channel inbox"
        goal="Подключить каналы в правильном порядке, понять что нажимать и не смешивать сообщения, SMS и звонки"
      >
        Откройте <HelpKey>Настройки</HelpKey> → <HelpKey>Каналы</HelpKey>. Это каталог каналов:
        сначала выберите категорию, потом конкретного провайдера. Уже сохранённые каналы остаются на
        этой же странице как карточки, которые можно редактировать.
      </HelpScenario>

      <HelpSection title="Видео-туториал за 60 секунд">
        <HelpStep n={1}>
          <p>
            Начните сверху. Вкладки делят каталог на <HelpKey>Все</HelpKey>,{" "}
            <HelpKey>Business Messaging</HelpKey>, <HelpKey>Звонки</HelpKey>, <HelpKey>SMS</HelpKey>,{" "}
            <HelpKey>Email</HelpKey> и <HelpKey>Live Chat</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Большие карточки провайдеров. На каждой карточке написано, для чего нужен канал, и есть
            кнопка <HelpKey>Подключить</HelpKey>, <HelpKey>Редактировать</HelpKey> или состояние{" "}
            <HelpKey>Скоро</HelpKey>.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Поиск используйте, когда карточек много. Например, введите <HelpKey>whatsapp</HelpKey>,{" "}
            <HelpKey>atl</HelpKey>, <HelpKey>facebook</HelpKey> или <HelpKey>3cx</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Карточки фильтруются сразу. Если ничего не найдено, очистите поиск и выберите вкладку.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Нажмите <HelpKey>Подключить</HelpKey> на нужном провайдере. Кнопку{" "}
            <HelpKey>+ Добавить канал</HelpKey> используйте только для ручной или нестандартной
            настройки.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Перед полями откроется чек-лист. Сначала прочитайте его: он показывает, что надо
            подготовить на стороне провайдера, прежде чем сохранять канал в LeadDrive.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Вставьте реквизиты, сохраните канал и отправьте один контролируемый тест или входящее
            сообщение, прежде чем использовать канал с реальными клиентами.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Секретные поля при редактировании выглядят пустыми. Оставьте их пустыми, чтобы сохранить
            старое значение; вводите новый секрет только если хотите заменить его.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Какую карточку выбрать?">
        <dl className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4">
          <HelpDef term="WhatsApp Business Platform">
            Официальный Meta WhatsApp Business API для сообщений в inbox и шаблонов. Для продакшн
            WhatsApp-переписки используйте эту карточку.
          </HelpDef>
          <HelpDef term="Facebook Messenger">
            Подключает Facebook-страницу, чтобы сообщения из Messenger попадали в Inbox.
          </HelpDef>
          <HelpDef term="Instagram">
            Используйте для Instagram Direct. Нужны Meta/Facebook permissions, которые показаны в форме.
          </HelpDef>
          <HelpDef term="Telegram">
            Подключает Telegram Bot. Создайте бота в BotFather и вставьте Bot Token в LeadDrive.
          </HelpDef>
          <HelpDef term="TikTok">
            В нашей схеме TikTok подключается через <strong>Chatwoot</strong>. Сначала подключите
            TikTok в Chatwoot, потом вставьте Chatwoot token/webhook данные в LeadDrive.
          </HelpDef>
          <HelpDef term="ATL SMS">
            Основной SMS-провайдер для Азербайджана. Используйте ATL-реквизиты для локальных SMS.
          </HelpDef>
          <HelpDef term="Email">
            Google Workspace, Gmail и Other Email используют похожую SMTP-настройку. Где провайдер
            требует app password, используйте именно его.
          </HelpDef>
          <HelpDef term="Звонки">
            Звонки отделены от каналов сообщений. Во вкладке звонков настраиваются Twilio, 3CX,
            Asterisk или SIP-провайдеры. Для WhatsApp Business Calling используйте отдельную карточку
            <HelpKey>WhatsApp Business Calling</HelpKey>, когда Meta app и Cloud API номер готовы к
            подписке calls events; не настраивайте WhatsApp Calling со страницы VoIP.
          </HelpDef>
          <HelpDef term="Website Chat">
            Канал для live-chat виджета на вашем сайте; сообщения попадают в тот же inbox.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Шаг за шагом: подключить WhatsApp Business">
        <HelpStep n={1}>
          <p>
            Откройте <HelpKey>Business Messaging</HelpKey> и нажмите <HelpKey>Подключить</HelpKey>{" "}
            на <HelpKey>WhatsApp Business Platform</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Чек-лист WhatsApp. Он просит Meta app с включённым WhatsApp, permanent access token,
            Phone Number ID, WABA ID, verify token и app secret.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Скопируйте эти значения из Meta Business / developers.facebook.com, вставьте в LeadDrive
            и сохраните.
          </p>
          <HelpCallout kind="warning">
            Если вы используете публичные тестовые номера Meta, шаблон <HelpKey>hello_world</HelpKey>{" "}
            можно отправлять только с публичных тестовых номеров Meta. Такая ошибка провайдера
            ожидаема: это ограничение Meta, а не поломка формы LeadDrive.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            После сохранения настройте webhook/templates в Meta и отправьте одно входящее сообщение,
            чтобы проверить, что оно появилось в Inbox.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: подключить Facebook или Instagram">
        <HelpStep n={1}>
          <p>
            Выберите <HelpKey>Facebook Messenger</HelpKey> для сообщений страницы/Messenger или{" "}
            <HelpKey>Instagram</HelpKey> для Instagram Direct.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Форма покажет Meta App ID, App Secret, verify token и callback/redirect URLs. Скопируйте
            URL в Meta без изменений.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Сначала сохраните канал. OAuth-подключение появляется только после того, как App ID и
            secret сохранены.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: подключить TikTok через Chatwoot">
        <HelpStep n={1}>
          <p>
            Сначала подключите TikTok внутри <HelpKey>Chatwoot</HelpKey>. LeadDrive использует
            Chatwoot как транспорт для TikTok.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            В LeadDrive выберите карточку <HelpKey>TikTok</HelpKey>, вставьте Chatwoot access token
            и webhook secret, затем сохраните.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            В каталоге канал всё равно отображается как TikTok, но технический провайдер внутри —
            Chatwoot.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: подключить Telegram">
        <HelpStep n={1}>
          <p>
            Откройте <HelpKey>Business Messaging</HelpKey>, выберите <HelpKey>Telegram</HelpKey> и
            нажмите <HelpKey>Подключить</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            В Telegram откройте <HelpKey>BotFather</HelpKey>, создайте или выберите support bot, а
            затем скопируйте <HelpKey>Bot Token</HelpKey> в LeadDrive.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Форма попросит Bot Token и необязательный Chat ID. Сохраните канал, отправьте одно
            сообщение боту и проверьте, что диалог появился в Inbox.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: подключить SMS через ATL">
        <HelpStep n={1}>
          <p>
            Откройте <HelpKey>SMS</HelpKey>, выберите <HelpKey>ATL SMS</HelpKey> и нажмите{" "}
            <HelpKey>Подключить</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Вставьте ATL login, password и sender title. Сохраните, затем откройте редактирование
            сохранённого канала и отправьте один контролируемый тест SMS из встроенного поля.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: подключить Email">
        <HelpStep n={1}>
          <p>
            Откройте <HelpKey>Email</HelpKey> и выберите <HelpKey>Google Workspace</HelpKey>,{" "}
            <HelpKey>Gmail</HelpKey> или <HelpKey>Other Email</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Подготовьте SMTP password или app password почтового ящика, вставьте реквизиты в
            LeadDrive и сохраните канал.
          </p>
          <HelpCallout kind="tip">
            Используйте <HelpKey>Other Email</HelpKey>, если провайдер не Google/Gmail, но умеет
            отправлять через SMTP.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: подключить Live Chat">
        <HelpStep n={1}>
          <p>
            Откройте <HelpKey>Live Chat</HelpKey>. Выберите <HelpKey>Website Chat</HelpKey> для
            виджета LeadDrive или <HelpKey>Custom Channel (Live Chat)</HelpKey>, если внешний чат
            должен пересылать диалоги через Integrations.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Для Website Chat перейдите в <HelpKey>Настройки → Web Chat</HelpKey>, настройте виджет,
            затем отправьте одно тестовое сообщение посетителя и проверьте Inbox.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: подключить Calls / VoIP">
        <HelpStep n={1}>
          <p>
            Откройте <HelpKey>Звонки</HelpKey>. Используйте <HelpKey>Twilio</HelpKey>,{" "}
            <HelpKey>3CX</HelpKey>, <HelpKey>Asterisk</HelpKey> или <HelpKey>Custom SIP</HelpKey>{" "}
            для обычных телефонных провайдеров; они ведут в <HelpKey>Настройки → VoIP</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>WhatsApp Business Calling</HelpKey> используйте только для readiness-проверки
            Meta WhatsApp Calling. Это отдельный чек-лист, не тот же flow, что SIP/PBX.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Найти, изменить или временно выключить канал">
        <HelpStep n={1}>
          <p>
            Найдите карточку через поиск или вкладки. У подключённых каналов вместо{" "}
            <HelpKey>Подключить</HelpKey> будет <HelpKey>Редактировать</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Нажмите <HelpKey>Редактировать</HelpKey>, чтобы переименовать канал, заменить реквизиты
            или переключить активность.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Для временной паузы выключайте канал, а не удаляйте его. Удаляйте только если точно
            хотите убрать сохранённые реквизиты.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpCallout kind="security">
        <p>
          Каналы привязаны к организации. Другой tenant не видит и не использует ваши токены.
          Секретные поля маскируются при чтении: пустое поле секрета при редактировании означает
          “оставить сохранённое значение”, а не “секрет потерян”.
        </p>
      </HelpCallout>
    </div>
  )
}
