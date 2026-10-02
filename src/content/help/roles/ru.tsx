"use client"

/**
 * Roles & Permissions — help article (Russian).
 * Settings → Roles & Permissions is a read-only reference of what each
 * built-in role can do; module access for one person is set in the user's card
 * (Settings → Users → "Module access"), and this article says so.
 */
import {
  HelpScenario,
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function RolesHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario
        persona="Вы администратор организации"
        goal="Понять, что может каждая роль, и ограничить конкретному сотруднику набор модулей"
      >
        Страница открывается через <HelpKey>Настройки</HelpKey> → <HelpKey>Роли и разрешения</HelpKey>. Это справочник: на ней ничего не редактируется.
      </HelpScenario>

      <HelpSection title="Что есть на странице">
        <p>
          Сверху — карточка с кнопкой <HelpKey>Открыть «Пользователи»</HelpKey>: доступ к модулям задаётся не здесь, а в карточке сотрудника. Ниже — список встроенных ролей с числом пользователей и таблица «Что может каждая роль»: слева модули, сверху роли, на пересечении уровень доступа.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="Полный">создание, изменение и удаление записей модуля.</HelpDef>
          <HelpDef term="Редакт.">создание и изменение, без удаления.</HelpDef>
          <HelpDef term="Просмотр">только чтение.</HelpDef>
          <HelpDef term="Нет">модуль этой роли недоступен.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Шаг за шагом: скрыть модуль от сотрудника">
        <HelpStep n={1}>Нажмите <HelpKey>Открыть «Пользователи»</HelpKey> и откройте нужного сотрудника (или создайте нового).</HelpStep>
        <HelpStep n={2}>В блоке <HelpKey>Доступ к модулям</HelpKey> снимите галочки с модулей, которые ему не нужны.</HelpStep>
        <HelpStep n={3}>Сохраните. Модуль пропадёт из меню сотрудника со следующего клика, перезаходить ему не нужно.</HelpStep>
        <HelpCallout kind="warning">
          Таблица ролей показывает права, которые система реально применяет. Изменить их на этой странице нельзя, и создать свою роль тоже: роль назначается сотруднику из встроенного списка.
        </HelpCallout>
        <HelpCallout kind="tip">
          Администратор всегда видит все модули организации — скрыть модуль от администратора нельзя.
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
