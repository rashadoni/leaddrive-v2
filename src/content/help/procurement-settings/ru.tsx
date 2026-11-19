"use client"

/**
 * «Лимиты согласования» — кто согласует заказ в зависимости от суммы (русский).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementSettingsHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Администратор" goal="Настроить, кто и в каком порядке согласует заказы поставщикам">
        Лимиты меняет только администратор, остальные видят правила. Заказ, не попавший ни в один диапазон, согласует руководитель.
      </HelpScenario>

      <HelpSection title="Что на странице">
        <dl className="rounded-md border p-3">
          <HelpDef term="Диапазон">суммы <HelpKey>От</HelpKey> и <HelpKey>До (пусто — без предела)</HelpKey>; заказ попадает в диапазон по своей сумме.</HelpDef>
          <HelpDef term="Согласующие по порядку">на каждом шаге — роль (Руководитель, Финансы, Закупки, Администратор) или конкретный сотрудник; шаги открываются по очереди.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Шаг за шагом">
        <HelpStep n={1}>
          <p>Нажмите <HelpKey>Добавить диапазон</HelpKey>, укажите, например, 0 — 5000 и выберите сотрудника на первом шаге.</p>
          <HelpCallout kind="see" label="Что вы увидите">Появляется карточка диапазона: на шаге «1.» выбранный сотрудник, например «Сотрудник: Lalə Quliyeva».</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Для крупных сумм снова <HelpKey>Добавить диапазон</HelpKey>: от 5000, «До» пусто; через <HelpKey>Добавить согласующего</HelpKey> — два шага: Руководитель, затем Финансы.</p>
          <HelpCallout kind="see" label="Что вы увидите">Во втором диапазоне два шага; второй откроется после первого.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Нажмите <HelpKey>Сохранить</HelpKey>.</p>
          <HelpCallout kind="see" label="Что вы увидите">«Сохранено»; новые правила действуют для следующих заказов, отправленных на согласование.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="warning">Диапазоны не должны пересекаться — иначе сохранить не получится.</HelpCallout>

      <HelpCallout kind="security">Автор заказа не согласует свой заказ; администратор может согласовать любой шаг. Финансы могут согласовывать, но не вести закупки.</HelpCallout>
    </div>
  )
}
