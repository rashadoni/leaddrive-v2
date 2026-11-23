"use client"

/**
 * Свой ключ Gemini — справочная статья (русский). Только для администраторов:
 * открывается с экрана «Настройки → ИИ и расходы». Владелец 2026-11-23:
 * «лёгкая пошаговая инструкция без воды, как регистрировать ключ».
 * Шаги Google — по docs Google AI Studio (ключ и оплата), прочитаны 2026-11-23.
 */
import { HelpCallout, HelpDef, HelpKey, HelpScenario, HelpSection, HelpStep } from "@/components/help/help-content"

export default function AiOwnKeyHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Администратор организации" goal="Платить Google за ИИ напрямую: подключить свой ключ Gemini">
        По умолчанию ИИ работает на ключе LeadDrive, и делать ничего не нужно. Свой ключ нужен, только если
        вы решили оплачивать Google сами. Понадобятся аккаунт Google компании и банковская карта.
      </HelpScenario>

      <HelpSection title="Что изменится">
        <dl className="rounded-md border p-3">
          <HelpDef term="Пойдёт на вашем ключе">Разговор ИИ в телефонных звонках и голосовой помощник. Счёт за них выставит Google — вам.</HelpDef>
          <HelpDef term="Останется на ключе LeadDrive">Озвучка голосом линии и распознавание речи в звонках.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Шаг за шагом">
        <HelpStep n={1}>
          <p>Откройте <HelpKey>aistudio.google.com/apikey</HelpKey> и войдите в аккаунт Google компании.</p>
          <HelpCallout kind="see" label="Что вы увидите">Страницу с ключами. Новому пользователю Google сам создаёт проект и первый ключ после согласия с условиями.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Если ключа в списке нет, нажмите <HelpKey>Create API key</HelpKey>.</p>
          <HelpCallout kind="see" label="Что вы увидите">Новый ключ в списке.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Включите оплату: в строке проекта, в столбце <HelpKey>Billing Tier</HelpKey>, нажмите <HelpKey>Set up billing</HelpKey>. Укажите страну и карту и внесите предоплату (от 5 долларов).</p>
          <HelpCallout kind="see" label="Что вы увидите">Проект перешёл с бесплатного уровня на платный. На бесплатном уровне лимиты малы — для звонков нужен платный.</HelpCallout>
        </HelpStep>
        <HelpStep n={4}>
          <p>Скопируйте ключ целиком.</p>
        </HelpStep>
        <HelpStep n={5}>
          <p>В CRM откройте <HelpKey>Настройки</HelpKey> → <HelpKey>ИИ и расходы</HelpKey>. В блоке <HelpKey>Ключи ИИ-провайдеров</HelpKey>, в строке Gemini, нажмите <HelpKey>Ввести свой ключ</HelpKey>.</p>
          <HelpCallout kind="see" label="Что вы увидите">Поле «Ключ Gemini».</HelpCallout>
        </HelpStep>
        <HelpStep n={6}>
          <p>Вставьте ключ и нажмите <HelpKey>Проверить и сохранить</HelpKey>.</p>
          <HelpCallout kind="see" label="Что вы увидите">В строке Gemini — «Ваш ключ» и его последние 4 знака. Если Google ключ не принял, CRM скажет об этом и ничего не сохранит.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Как проверить, что работает">
        <p>После следующего звонка или разговора с помощником откройте таблицу расходов на этом же экране: у строки в столбце <HelpKey>Чей ключ</HelpKey> стоит «Ваш ключ».</p>
      </HelpSection>

      <HelpSection title="Вернуть как было">
        <p>В строке Gemini нажмите <HelpKey>Удалить ключ</HelpKey>. ИИ снова работает на ключе LeadDrive.</p>
      </HelpSection>

      <HelpCallout kind="warning" label="Важно">
        Если Google отклонит ваш ключ во время звонка (например, на счёте кончились деньги), звонок не оборвётся: он пройдёт на ключе LeadDrive и попадёт в расход на ключе LeadDrive.
      </HelpCallout>
      <HelpCallout kind="security" label="Безопасность">
        Ключ хранится зашифрованным. На экране видны только его последние 4 знака, и только администраторам.
      </HelpCallout>
    </div>
  )
}
