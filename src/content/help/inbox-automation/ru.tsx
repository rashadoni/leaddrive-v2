"use client"

/**
 * Inbox Automation — help article (Russian).
 * Source script for the route-aware help video on /inbox/automation.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function InboxAutomationHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Вы управляете живыми диалогами инбокса"
        goal="Собрать один безопасный маршрут без случайных ответов клиентам"
      >
        Откройте <HelpKey>Omni-Channel</HelpKey> → <HelpKey>Автоматизация</HelpKey>. Страница
        разделена по задачам: обзор, конструктор, сохранённые сценарии и последние запуски.
        Начинайте с <HelpKey>Сборка</HelpKey>; визуальный canvas нужен для редактирования уже
        сохранённых сценариев, а не для первого шага.
      </HelpScenario>

      <HelpSection title="Что делает эта страница">
        <p>
          Автоматизация инбокса создаёт сценарии для входящих сообщений. Сценарий может назначить
          диалог в очередь, отправить фиксированный ответ, дать ответ через AI, передать агенту,
          обновить поле контакта, уведомить команду или закрыть диалог.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Очередь">Куда попадёт диалог: например продажи, поддержка, VIP или TikTok leads.</HelpDef>
          <HelpDef term="Сценарий">Правило, которое запускается при новом входящем сообщении из выбранных каналов.</HelpDef>
          <HelpDef term="Действия">Шаги, которые LeadDrive выполняет после триггера.</HelpDef>
          <HelpDef term="Запуски">Журнал проверки: что реально произошло во время контролируемого теста.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Пошагово: создать первый маршрут">
        <HelpStep n={1}>
          <p>
            Нажмите <HelpKey>Сборка</HelpKey>. В карте работы посмотрите первый недостающий шаг.
            Если очереди ещё нет, создайте её в блоке <HelpKey>Командные очереди</HelpKey>.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Полоса настройки отметит <HelpKey>Создайте очередь</HelpKey> как следующий шаг. После
            сохранения очереди первое действие сможет использовать её как назначение.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Дайте сценарию понятное имя и оставьте статус <HelpKey>Черновик</HelpKey> или{" "}
            <HelpKey>Пауза</HelpKey>, пока готовите маршрут.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Карта работы покажет, что имя сценария готово, но живой трафик всё ещё защищён.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Выберите каналы, где работает маршрут: TikTok, WhatsApp, Telegram, email, SMS,
            Facebook, Instagram, VKontakte или web chat.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Выбранные каналы подсветятся. Если добавить <HelpKey>Отправить ответ</HelpKey> или{" "}
            <HelpKey>Ответ AI</HelpKey>, неподдерживаемые каналы покажут предупреждение до
            сохранения.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Добавьте действия по порядку. Для первого безопасного маршрута используйте{" "}
            <HelpKey>Назначить в очередь</HelpKey>. Ответы добавляйте только после проверки, что
            выбранный канал поддерживает отправку.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Preview сценария обновится от <HelpKey>message_inbound</HelpKey> к действиям и затем к{" "}
            <HelpKey>end</HelpKey>. Пустая очередь или пустой текст ответа блокируют сохранение.
          </HelpCallout>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Сохраните сценарий, отправьте одно контролируемое тестовое сообщение, затем откройте{" "}
            <HelpKey>Запуски</HelpKey> и проверьте точный путь.
          </p>
          <HelpCallout kind="see" label="Что вы увидите">
            Последние запуски показывают имя сценария, диалог, статус, текущий node и количество
            шагов. Только после этой проверки стоит использовать live-флаг и активный статус вместе.
          </HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="warning" label="Правило безопасности">
        Сохранение сценария — это настройка. Оно не должно само запускать ответы реальным клиентам.
        Live-включение считайте отдельным контролируемым шагом после успешного теста.
      </HelpCallout>

      <HelpCallout kind="tip" label="Самый безопасный старт">
        Сначала используйте шаблон <HelpKey>Направить сообщения команде</HelpKey>. Он создаёт
        простой черновик “входящее сообщение → очередь”, который легче проверить, чем AI-ответы.
      </HelpCallout>
    </div>
  )
}
