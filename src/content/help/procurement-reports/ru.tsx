"use client"

/**
 * «Отчёты по закупкам» — расходы, сроки и маржа (русский).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementReportsHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Руководитель, финансы или закупки" goal="Посмотреть закупки за период: сколько потрачено, вовремя ли везли поставщики, сколько принесли сделки">
        В отчёт попадают заказы поставщикам, созданные за выбранный период. Отчёты и их файлы видят руководство, финансы и закупки.
      </HelpScenario>

      <HelpSection title="Что на странице">
        <dl className="rounded-md border p-3">
          <HelpDef term="Показатели">Заказов, Расход (согласовано), Вовремя, Среднее опоздание, Опаздывают сейчас, Согласование длится.</HelpDef>
          <HelpDef term="Поставщики">по каждому поставщику — число заказов, расход, вовремя и с опозданием, среднее опоздание (дни).</HelpDef>
          <HelpDef term="Маржа по сделкам">выручка, себестоимость и маржа; заказ в другой валюте не смешивается — показан как «другая валюта».</HelpDef>
          <HelpDef term="Заказы">номер, поставщик, сделка, статус, ожидаемая дата и сумма.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Шаг за шагом">
        <HelpStep n={1}>
          <p>Выберите даты <HelpKey>С</HelpKey> и <HelpKey>По</HelpKey> и нажмите <HelpKey>Показать</HelpKey>.</p>
          <HelpCallout kind="see" label="Что вы увидите">Показатели и три таблицы пересчитываются за этот период.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Нужен файл — нажмите <HelpKey>Excel</HelpKey> или <HelpKey>PDF</HelpKey>.</p>
          <HelpCallout kind="see" label="Что вы увидите">Отчёт за выбранный период скачивается файлом.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">«Вовремя» и «Среднее опоздание» считаются в календарных днях: между ожидаемой датой и фактической приёмкой.</HelpCallout>

      <HelpCallout kind="warning">Валюты не складываются: в CRM нет курсов, поэтому расход в другой валюте показан отдельно и в маржу не входит.</HelpCallout>
    </div>
  )
}
