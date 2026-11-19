"use client"

/**
 * «Заказы поставщикам» — согласование, отправка, поставка и приёмка (русский).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementOrdersHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Сотрудник закупок, руководитель или финансы" goal="Провести заказ через согласование, отправить поставщику и принять товар">
        Заказ создаётся из предложения поставщика в заявке на закупку. Кто согласует — решают «Лимиты согласования».
      </HelpScenario>

      <HelpSection title="Что на странице">
        <dl className="rounded-md border p-3">
          <HelpDef term="Список">номер (PO-0001), поставщик, сделка, статус, ожидаемая дата и сумма.</HelpDef>
          <HelpDef term="Фильтры"><HelpKey>Открытые</HelpKey> и <HelpKey>Только опаздывающие</HelpKey>.</HelpDef>
          <HelpDef term="Статусы">Черновик → На согласовании → Согласован → Отправлен поставщику → В производстве → В пути → Принят частично → Принят; а также Отклонён и Отменён.</HelpDef>
          <HelpDef term="Страница заказа"><HelpKey>Позиции</HelpKey> (количество, цена, сумма, сколько принято), <HelpKey>Согласование</HelpKey> (кто, какой шаг) и <HelpKey>История</HelpKey>.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Шаг за шагом: от согласования до отправки">
        <HelpStep n={1}>
          <p>Откройте черновик заказа и нажмите <HelpKey>Отправить на согласование</HelpKey>.</p>
          <HelpCallout kind="see" label="Что вы увидите">Статус — «На согласовании»; в блоке «Согласование» видна цепочка по сумме — например, «1. Lalə Quliyeva».</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Согласующий нажимает <HelpKey>Согласовать</HelpKey> или <HelpKey>Отклонить</HelpKey> с причиной.</p>
          <HelpCallout kind="see" label="Что вы увидите">После согласования статус — «Согласован»; отклонённый заказ можно поправить и отправить снова новой редакцией.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Нажмите <HelpKey>Отправлен поставщику</HelpKey>. Если нужно, отметьте <HelpKey>Отправить поставщику PDF заказа по e-mail</HelpKey>, укажите адрес и язык PDF.</p>
          <HelpCallout kind="see" label="Что вы увидите">Статус — «Отправлен поставщику»; результат письма пишется в историю. PDF всегда можно открыть кнопкой <HelpKey>PDF</HelpKey>.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: поставка и приёмка">
        <HelpStep n={1}>
          <p>По мере новостей от поставщика нажимайте <HelpKey>В производстве</HelpKey> и <HelpKey>В пути</HelpKey>.</p>
          <HelpCallout kind="see" label="Что вы увидите">Каждая смена статуса остаётся в истории.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Срок сдвигается — <HelpKey>Изменить срок</HelpKey>: новая дата и <HelpKey>Почему сдвинулся срок?</HelpKey>.</p>
          <HelpCallout kind="see" label="Что вы увидите">Новая ожидаемая дата видна в заголовке; без причины срок отправленного заказа не меняется.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Когда товар пришёл, нажмите <HelpKey>Принять товар</HelpKey> и укажите, сколько пришло по каждой позиции.</p>
          <HelpCallout kind="see" label="Что вы увидите">В колонке «Принято» видно, например, «8 / 12», статус — «Принят частично»; когда пришло всё — «Принят».</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpCallout kind="tip">Заказ с прошедшей датой, который ещё не принят, система проверяет каждый час: ставит пометку «Опаздывает» и один раз уведомляет владельца сделки, автора заявки и закупки.</HelpCallout>

      <HelpCallout kind="warning">Принять больше, чем заказано, нельзя. Если сделка изменилась после отправки, заказ получает пометку «сделка изменилась — проверьте»: поговорите с поставщиком и нажмите «Проверено».</HelpCallout>

      <HelpCallout kind="security">Автор заказа не согласует свой заказ; администратор может согласовать любой шаг. Продажи видят статус заказа, но не цены.</HelpCallout>
    </div>
  )
}
