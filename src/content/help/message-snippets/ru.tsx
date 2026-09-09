"use client"

import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MessageSnippetsHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Вы администратор инбокса или руководитель команды"
        goal="Подготовить повторяемые ответы, чтобы агенты не писали один и тот же текст заново"
      >
        Сниппеты сообщений — это готовые ответы для композера в инбоксе. Агент набирает команду вроде{" "}
        <HelpKey>/greeting</HelpKey>, выбирает сниппет, проверяет текст и отправляет его из диалога.
      </HelpScenario>

      <HelpSection title="Что означает каждое поле">
        <dl className="rounded-md border p-3">
          <HelpDef term="Ярлык">Слово, которое агент вводит после слэша. Используйте одно слово, без пробелов и /.</HelpDef>
          <HelpDef term="Название">Внутреннее название для команды. Клиенты его не видят.</HelpDef>
          <HelpDef term="Текст">
            Сам ответ для клиента. Можно использовать переменные, например <code>{"{{contact.name}}"}</code> и{" "}
            <code>{"{{agent.name}}"}</code>.
          </HelpDef>
          <HelpDef term="Каналы">
            Оставьте пустым, если текст подходит всем каналам. Выберите каналы, если ответ должен появляться
            только в WhatsApp, Telegram, SMS, email или web chat.
          </HelpDef>
          <HelpDef term="Активен">
            Выключите, чтобы сохранить сниппет, но скрыть его от агентов в инбоксе.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Создать сниппет">
        <HelpStep n={1}>
          <p>
            Нажмите <HelpKey>Новый сниппет</HelpKey>, введите короткий ярлык и понятное внутреннее название.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Напишите готовый ответ в поле <HelpKey>Текст</HelpKey>. Он должен быть почти готов к отправке, но
            агент всё равно увидит его перед отправкой.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Оставьте <HelpKey>Каналы</HelpKey> пустыми для всех каналов или выберите только те, где сниппет должен
            показываться.
          </p>
          <HelpCallout kind="tip">
            Канальные сниппеты полезны, когда тон, ссылки или формат отличаются для WhatsApp, SMS, email и web chat.
          </HelpCallout>
        </HelpStep>
      </HelpSection>
    </div>
  )
}
