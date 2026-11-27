"use client"

import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function MessageSnippetsHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Вы руководите командой, которая отвечает клиентам" goal="Чтобы менеджеры не набирали один и тот же ответ заново">
        Готовые ответы — частые ответы клиентам. В переписке наберите <HelpKey>/</HelpKey> и выберите ответ из списка: имя клиента встанет само, а текст можно поправить перед отправкой.
      </HelpScenario>

      <HelpSection title="Поля в окне">
        <dl className="rounded-md border p-3">
          <HelpDef term="Что набирать в переписке">Одно слово после /, например <HelpKey>/privet</HelpKey>. Пробелы и / убираются сами.</HelpDef>
          <HelpDef term="Название">Видят только сотрудники — чтобы найти ответ в списке.</HelpDef>
          <HelpDef term="Текст ответа">То, что прочтёт клиент. Кнопки «+ Имя клиента», «+ Моё имя» ставят в текст оранжевое слово — при вставке оно заменится данными клиента.</HelpDef>
          <HelpDef term="Где показывать">«Во всех каналах» или «Только в выбранных» — например, только WhatsApp и SMS.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Как создать ответ">
        <HelpStep n={1}>
          <p>В первый раз: в блоке «Начните с готовых» нажмите <HelpKey>Добавить</HelpKey> у нужного ответа.</p>
        </HelpStep>
        <HelpStep n={2}>
          <p>Для своего текста нажмите <HelpKey>Новый ответ</HelpKey> и заполните три поля. Справа видно, что прочтёт клиент.</p>
        </HelpStep>
        <HelpStep n={3}>
          <p>Нажмите <HelpKey>Сохранить ответ</HelpKey> и проверьте его в переписке, набрав /. Попробовать можно и в окне наверху страницы.</p>
          <HelpCallout kind="tip">Чтобы временно спрятать ответ, выключите его переключателем в строке — он не удалится.</HelpCallout>
        </HelpStep>
      </HelpSection>
    </div>
  )
}
