"use client"

/**
 * Integrations & API Keys — help article (Russian).
 * Зеркало en.tsx: Настройки → Интеграции (вебхуки, Google Calendar, Slack,
 * Zapier) + Настройки → API-ключи (программный доступ по Bearer-токену).
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function IntegrationsHelpRu() {
  return (
    <div className="space-y-6">
      <HelpSection title="Зачем это нужно">
        <p>
          Две страницы настроек связывают вашу CRM с внешним миром.{" "}
          <strong>Интеграции</strong> отдают данные <em>наружу</em> — вебхуки срабатывают на
          события, Google Calendar синхронизируется, Slack получает уведомления.{" "}
          <strong>API-ключи</strong> позволяют внешним системам читать и писать ваши данные{" "}
          <em>внутрь</em>, через REST API.
        </p>
        <p>
          Всё здесь ограничено вашей организацией. Вебхук видит только события вашего
          тенанта, а API-ключ касается только данных вашего тенанта.
        </p>
      </HelpSection>

      <HelpSection title="Вебхуки — отправка событий на любой URL">
        <p>
          Вебхук отправляет JSON на контролируемый вами URL всякий раз, когда происходит
          выбранное событие. Вы выбираете интересующие события — LeadDrive сам делает вызов.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Контакты">contact.created, contact.updated, contact.deleted</HelpDef>
          <HelpDef term="Сделки">deal.created, deal.updated, deal.stage_changed</HelpDef>
          <HelpDef term="Лиды">lead.created, lead.updated</HelpDef>
          <HelpDef term="Тикеты">ticket.created, ticket.updated, ticket.resolved</HelpDef>
          <HelpDef term="Компании">company.created, company.updated</HelpDef>
        </dl>
        <HelpStep n={1}>
          <p>
            Нажмите <HelpKey>Добавить вебхук</HelpKey>, вставьте URL назначения и отметьте
            события, которые должны его запускать (хотя бы одно). Сохраните кнопкой{" "}
            <HelpKey>Создать вебхук</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            При создании вы получите <strong>секрет подписи</strong>, показанный один раз, —
            скопируйте его. Зелёная / серая точка рядом с вебхуком переключает его{" "}
            <em>активность</em>; значок корзины удаляет его.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Каждая доставка — это <HelpKey>POST</HelpKey> с JSON-телом{" "}
            <code>{`{ event, timestamp, organizationId, data }`}</code> и тремя заголовками:{" "}
            <HelpKey>X-Webhook-Signature</HelpKey> (HMAC-SHA256 от тела, на ключе вашего
            секрета), <HelpKey>X-Webhook-Event</HelpKey> и{" "}
            <HelpKey>X-Webhook-Attempt</HelpKey>.
          </p>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            Всегда <strong>проверяйте подпись</strong>, прежде чем доверять данным:
            пересчитайте HMAC-SHA256 от сырого тела с вашим секретом и сравните с{" "}
            <HelpKey>X-Webhook-Signature</HelpKey>. Доставка повторяется до 3 раз с
            задержкой (1с, 4с, 16с) при сетевых ошибках или 5xx / 429; ответ 4xx (кроме 429)
            считается окончательным сбоем и не повторяется. Запросы на приватные / внутренние
            URL блокируются (защита от SSRF), поэтому адрес назначения должен быть доступен из
            интернета.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Zapier и no-code инструменты">
        <p>
          Отдельной настройки Zapier нет — направьте вебхук на URL, который вам даёт Zapier
          (или Make, n8n, любой инструмент с catch-hook), и каждое подходящее событие пойдёт
          прямо туда. То же касается любой платформы, способной принять HTTP POST.
        </p>
        <HelpCallout kind="tip">
          <p>
            Поле URL вебхука даже подставляет подсказку-заглушку{" "}
            <HelpKey>https://hooks.zapier.com/…</HelpKey>. Вставьте туда реальный URL
            catch-hook.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Google Calendar — двусторонняя синхронизация">
        <p>
          Подключение Google Calendar связывает <em>ваш</em> Google-аккаунт с LeadDrive через
          OAuth, с доступом на чтение и запись событий календаря.
        </p>
        <HelpStep n={1}>
          <p>
            Нажмите <HelpKey>Подключить</HelpKey> на карточке Google Calendar. Вас перенесёт
            на экран согласия Google; подтвердите — и вы вернётесь на эту страницу с
            карточкой в состоянии <em>Подключено</em>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            <HelpKey>Отключить</HelpKey> (с подтверждением) удаляет сохранённую авторизацию.
            Подключение <strong>по пользователю</strong> — каждый сотрудник подключает свой
            календарь.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            Для Google Calendar на сервере должны быть настроены учётные данные Google OAuth.
            Если они не настроены, <HelpKey>Подключить</HelpKey> не сработает, и карточка
            останется в состоянии <em>Не подключено</em> — обратитесь к администратору.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Slack — уведомления в канал">
        <p>
          Slack использует <strong>URL входящего вебхука</strong>, который вы создаёте в
          своём рабочем пространстве Slack. LeadDrive отправляет сообщения в тот канал, на
          который указывает этот URL.
        </p>
        <HelpStep n={1}>
          <p>
            Создайте входящий вебхук в Slack, затем нажмите здесь{" "}
            <HelpKey>Добавить вебхук Slack</HelpKey>, дайте имя, вставьте URL{" "}
            <HelpKey>https://hooks.slack.com/services/…</HelpKey> и сохраните кнопкой{" "}
            <HelpKey>Добавить интеграцию</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Кнопка <HelpKey>Тест</HelpKey> отправит разовое проверочное сообщение в канал —{" "}
            <em>Тест отправлен!</em> подтверждает, что URL работает. Значок корзины удаляет
            конфигурацию.
          </p>
        </HelpStep>
        <HelpCallout kind="tip">
          <p>
            Можно добавить несколько конфигураций Slack (например, один канал для сделок,
            другой для тикетов). Каждая — это просто именованный URL входящего вебхука.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="API-ключи — программный доступ">
        <p>
          API-ключ — это <strong>Bearer-токен</strong>, который позволяет внешней системе
          вызывать REST API LeadDrive от имени вашей организации. У каждого ключа есть набор{" "}
          <strong>скоупов</strong>, ограничивающих, что именно он может делать.
        </p>
        <HelpStep n={1}>
          <p>
            Нажмите <HelpKey>Создать ключ</HelpKey>, дайте внутреннее имя, при желании
            задайте срок (<em>Никогда</em>, 30, 90 или 365 дней) и отметьте нужные интеграции
            скоупы. Имя и хотя бы один скоуп обязательны.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Скоупы бывают <HelpKey>read:&lt;модуль&gt;</HelpKey> и{" "}
            <HelpKey>write:&lt;модуль&gt;</HelpKey> по каждому модулю (контакты, сделки, лиды,
            тикеты, счета и т.д.). Скоуп <em>write</em> также покрывает <em>read</em> того же
            модуля. Выдавайте только необходимое — <strong>минимальные привилегии</strong>.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Полный ключ (с префиксом <HelpKey>ld_</HelpKey>) показывается{" "}
            <strong>один раз</strong>, сразу после создания, с кнопкой копирования и готовым
            примером <code>curl -H &quot;Authorization: Bearer ld_…&quot;</code>. Используйте
            его в заголовке <HelpKey>Authorization: Bearer</HelpKey> своих запросов.
          </p>
        </HelpStep>
        <HelpCallout kind="warning">
          <p>
            <strong>Скопируйте ключ до закрытия окна</strong> — хранится только короткий
            префикс, полный ключ хэшируется и больше не показывается. Потеряете —
            придётся создать новый.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Управление и отзыв ключей">
        <p>
          В списке для каждого ключа видны префикс, бейдж <em>Активен</em> или{" "}
          <em>отозван</em>, число скоупов, когда он использовался в последний раз, когда
          истекает и когда создан.
        </p>
        <HelpStep n={1}>
          <p>
            Значок корзины <strong>отзывает</strong> ключ (после подтверждения). Отзыв
            мгновенный — любая интеграция, использующая этот ключ, тут же перестаёт работать.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Запрос также не пройдёт, если ключ <strong>просрочен</strong> или у него нет
            скоупа для вызываемого модуля и метода. Метка <HelpKey>Последнее использование</HelpKey>{" "}
            обновляется при каждом успешном вызове, так что вы заметите устаревшие или
            неожиданно активные ключи.
          </p>
        </HelpStep>
        <HelpCallout kind="security">
          <p>
            Создавать и отзывать API-ключи могут только <strong>администраторы</strong> (и
            суперадмины); другим ролям диалог создания даже не открыть. Отозванный ключ нельзя
            вернуть — выпустите новый и обновите интеграцию. Относитесь к ключам как к
            паролям: храните в менеджере секретов, никогда не в системе контроля версий.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Как всё это работает вместе">
        <ol className="list-decimal pl-5 space-y-1">
          <li>Сделка меняет этап → <strong>вебхук</strong> отправляет событие POST&apos;ом на ваш URL.</li>
          <li>Ваш инструмент автоматизации (Zapier / Make / свой) получает его и реагирует.</li>
          <li>Чтобы записать обратно — создать запись, обновить контакт — он вызывает REST API с <strong>API-ключом</strong>, у которого скоуп только на нужный модуль.</li>
          <li>А <strong>Slack</strong> и <strong>Google Calendar</strong> держат канал команды и расписание в курсе.</li>
        </ol>
      </HelpSection>
    </div>
  )
}
