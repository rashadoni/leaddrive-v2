"use client"

/**
 * Macros — справка по T7 (русский).
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function MacrosHelpRu() {
  return (
    <div className="space-y-6">
      <HelpSection title="Что делает макрос">
        <p>
          <strong>Макрос</strong> — это сохранённая последовательность действий, которую вы
          применяете к тикету в один клик. Вместо{" "}
          <em>сменить статус → сменить приоритет → переназначить → добавить ответ → тег</em>,
          вы запускаете один макрос и вся цепочка отрабатывает атомарно.
        </p>
        <p>
          Сделано для саппорт / ops-команд работающих с высоким потоком тикетов с
          повторяющимся флоу: <em>&laquo;затриажить как billing&raquo;</em>,{" "}
          <em>&laquo;эскалейт на tier-2&raquo;</em>, <em>&laquo;закрыть как дубль&raquo;</em>.
        </p>
      </HelpSection>

      <HelpSection title="Создать макрос">
        <HelpStep n={1}>
          <p>
            <HelpKey>Settings → Macros</HelpKey>. Жмите <HelpKey>New macro</HelpKey>.
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Назовите (например <em>&laquo;Triage as billing&raquo;</em>), выберите категорию{" "}
            (<em>general / billing / technical / onboarding / sales</em>), при желании
            добавьте описание и сочетание клавиш.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Добавьте <strong>действия</strong> по порядку. Макрос выполнит их сверху-вниз.
            Доступные типы:
          </p>
          <dl className="rounded-md border p-3 mt-2">
            <HelpDef term="set_status">Сменить статус: new / in_progress / waiting / resolved / closed.</HelpDef>
            <HelpDef term="set_priority">Сменить приоритет: low / medium / high / critical.</HelpDef>
            <HelpDef term="set_assignee">Переназначить тикет на пользователя.</HelpDef>
            <HelpDef term="add_comment">Добавить публичный ответ (виден клиенту).</HelpDef>
            <HelpDef term="add_internal_note">Добавить приватную заметку (только внутри).</HelpDef>
            <HelpDef term="add_tag">Добавить тег.</HelpDef>
            <HelpDef term="remove_tag">Убрать тег.</HelpDef>
          </dl>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            Опционально — <strong>горячая клавиша</strong> (например <code>cmd+shift+1</code>),
            чтобы запускать макрос с любого тикета не открывая меню. Сохраните с включённым{" "}
            <em>Active</em>.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Запустить макрос на тикете">
        <HelpStep n={1}>
          <p>
            Откройте детальную страницу тикета. Найдите запускатель макросов{" "}
            (<HelpKey>Macros</HelpKey> иконка/кнопка в тулбаре).
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Выберите макрос по имени, или жмите его горячую клавишу откуда угодно на странице
            тикета. Все действия отрабатывают по очереди, тикет перерисовывается с применёнными
            изменениями.
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Счётчик <em>usageCount</em> у макроса инкрементируется — популярные макросы
            всплывают выше в лаунчере в следующий раз.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Полезные паттерны">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Triage as billing</strong> — <em>set_priority=medium</em>,{" "}
            <em>add_tag=billing</em>, <em>set_assignee=billing-team-lead</em>,{" "}
            <em>add_internal_note=&laquo;Routed via macro&raquo;</em>.
          </li>
          <li>
            <strong>Close as duplicate</strong> — <em>set_status=closed</em>,{" "}
            <em>add_tag=duplicate</em>, <em>add_comment=&laquo;Дубль #XYZ — смотрите оригинал.&raquo;</em>.
          </li>
          <li>
            <strong>Escalate to tier-2</strong> — <em>set_priority=high</em>,{" "}
            <em>set_assignee=tier2-lead</em>, <em>add_tag=escalated</em>,{" "}
            <em>add_internal_note=&laquo;См. ветку для контекста.&raquo;</em>.
          </li>
          <li>
            <strong>Awaiting customer</strong> — <em>set_status=waiting</em>,{" "}
            <em>add_tag=awaiting-customer</em>,{" "}
            <em>add_comment=&laquo;Нужно немного больше информации...&raquo;</em>.
          </li>
        </ul>
      </HelpSection>

      <HelpSection title="Советы и ограничения">
        <HelpCallout kind="tip" label="Совет">
          <p>
            <strong>Порядок имеет значение.</strong> Действия идут сверху-вниз — если{" "}
            <em>set_status=closed</em> первым, а <em>add_comment</em> вторым, комментарий
            приходит после закрытия (всё ещё виден, но timestamp пост-закрытия). Меняйте порядок
            если это важно для аудит-трейла.
          </p>
        </HelpCallout>
        <HelpCallout kind="warning" label="Внимание">
          <p>
            Макросы нельзя откатить. Кнопки &laquo;undo macro&raquo; нет. Если макрос
            отработал неправильно (не тот клиент, не тот тег) — отменяйте каждое действие
            вручную. Для рискованных макросов держите <em>Active</em> выключенным пока не
            прогнали на тестовом тикете.
          </p>
        </HelpCallout>
        <HelpCallout kind="security" label="Безопасность">
          <p>
            Макрос выполняется <strong>в сессии вызывающего пользователя</strong> — внутри
            самого макроса нет границ привилегий. Эффект макроса = то что тот же пользователь
            может сделать руками редактируя тикет, просто упаковано в один клик. Подходите
            осознанно к тому кто создаёт общие макросы: макрос который закрывает тикеты может
            запустить кто угодно у кого есть право запускать макросы вообще.
          </p>
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
