"use client"

/**
 * «Поставщики» — компании, у которых вы покупаете (русский).
 */
import { HelpScenario, HelpSection, HelpStep, HelpCallout, HelpKey, HelpDef } from "@/components/help/help-content"

export default function ProcurementSuppliersHelpRu() {
  return (
    <div className="space-y-6">
      <HelpScenario persona="Сотрудник закупок" goal="Держать поставщиков в одном месте и связать их с товарами">
        Поставщик — тоже компания со своими контактами, файлами и историей, но в список клиентов он не попадает. Добавление и импорт — работа закупок.
      </HelpScenario>

      <HelpSection title="Что на странице">
        <dl className="rounded-md border p-3">
          <HelpDef term="Список">название (под ним руководитель), VÖEN, телефон, e-mail и город.</HelpDef>
          <HelpDef term="Поиск">«Поиск по названию, VÖEN, телефону или e-mail».</HelpDef>
          <HelpDef term="Фильтры"><HelpKey>Активные</HelpKey>, <HelpKey>Неактивные</HelpKey>, <HelpKey>Все</HelpKey>.</HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Шаг за шагом: добавить поставщика">
        <HelpStep n={1}>
          <p>Нажмите <HelpKey>Добавить поставщика</HelpKey>.</p>
          <HelpCallout kind="see" label="Что вы увидите">Окно: название, VÖEN, руководитель, телефон, e-mail, сайт, город, адрес и заметки.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Укажите хотя бы название, в заметке — условия оплаты, и нажмите <HelpKey>Сохранить</HelpKey>.</p>
          <HelpCallout kind="see" label="Что вы увидите">Поставщик появляется в списке; его e-mail потом используется для отправки PDF заказа.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Шаг за шагом: импорт из Excel">
        <HelpStep n={1}>
          <p>Нажмите <HelpKey>Импорт из Excel</HelpKey> и выберите файл .xlsx или .csv кнопкой <HelpKey>Выбрать файл</HelpKey> (в первой строке — названия колонок).</p>
          <HelpCallout kind="see" label="Что вы увидите">Система сама узнаёт колонки — «Ad / Название», «VÖEN», «Телефон», «E-mail» — и показывает, какая колонка в какое поле идёт; при необходимости поменяйте.</HelpCallout>
        </HelpStep>
        <HelpStep n={2}>
          <p>Нажмите <HelpKey>Проверить</HelpKey>.</p>
          <HelpCallout kind="see" label="Что вы увидите">Видно, сколько поставщиков будет добавлено, дубликаты и строки с ошибками — пока ничего не записано.</HelpCallout>
        </HelpStep>
        <HelpStep n={3}>
          <p>Нажмите <HelpKey>Импортировать</HelpKey>.</p>
          <HelpCallout kind="see" label="Что вы увидите">Новые поставщики добавлены в список; уже существующие (тот же VÖEN или название) пропущены.</HelpCallout>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Поставщик и товар">
        <p>В блоке «Закупка» карточки товара вы выбираете поставщика по умолчанию — вместе с закупочной ценой и сроком поставки. Когда этот товар добавляют в сделку, закупочная цена становится плановой себестоимостью строки.</p>
      </HelpSection>

      <HelpCallout kind="tip">Не удаляйте поставщика, с которым больше не работаете, — сделайте его неактивным: старые заказы и отчёты остаются связаны с ним.</HelpCallout>

      <HelpCallout kind="security">Закупочную цену и поставщика по умолчанию видят только руководство, финансы и закупки.</HelpCallout>
    </div>
  )
}
