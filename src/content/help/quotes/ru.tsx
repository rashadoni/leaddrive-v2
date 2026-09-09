"use client"

/**
 * S6 CPQ — справка по разделу «Коммерческие предложения» (русский).
 */
import {
  HelpSection,
  HelpStep,
  HelpCallout,
  HelpKey,
  HelpDef,
} from "@/components/help/help-content"

export default function QuotesHelpRu() {
  return (
    <div className="space-y-6">
      <HelpSection title="Что такое коммерческое предложение?">
        <p>
          <strong>Коммерческое предложение</strong> (quote, КП) — это документ, который вы
          отправляете клиенту между открытой сделкой и подписанным контрактом. В нём
          фиксируется <em>что</em> вы продаёте, <em>по какой цене</em> и <em>как долго</em> цена
          действительна.
        </p>
        <p>
          Каждое КП имеет версию, статус и связано с родительской сделкой — все изменения,
          отправки, просмотры и отказы автоматически логируются в CRM, без отдельных табличек в Excel.
        </p>
      </HelpSection>

      <HelpSection title="Когда использовать">
        <ul className="list-disc pl-5 space-y-1">
          <li>Клиент спросил &laquo;сколько будет стоить?&raquo; — отправляйте КП, а не письмо от руки.</li>
          <li>Вы собираете пакет из нескольких позиций (например <em>3× подписка + 1× setup + 10% скидка</em>).</li>
          <li>Сделка на финальной стадии и вам нужен подписанный документ перед стартом работ.</li>
        </ul>
      </HelpSection>

      <HelpSection title="Как создать КП">
        <HelpStep n={1}>
          <p>
            Нажмите <HelpKey>New Quote</HelpKey> на странице Quotes (справа сверху).
          </p>
        </HelpStep>
        <HelpStep n={2}>
          <p>
            Укажите <strong>номер КП</strong> (например <code>Q-2026-001</code>),{" "}
            <strong>валюту</strong> (по умолчанию AZN — формат ISO-4217, три заглавные буквы),
            при необходимости — <strong>срок действия</strong> (<em>Valid until</em>).
          </p>
        </HelpStep>
        <HelpStep n={3}>
          <p>
            Добавьте строки: название продукта/услуги, количество, цена за единицу, при желании —
            скидка по строке. Кнопка <HelpKey>Add line</HelpKey> добавляет ещё строку.
          </p>
        </HelpStep>
        <HelpStep n={4}>
          <p>
            По желанию — общая скидка на КП: переключатель <em>None / Amount / %</em>. Можно
            использовать только один режим одновременно.
          </p>
        </HelpStep>
        <HelpStep n={5}>
          <p>
            Жмите <HelpKey>Create draft</HelpKey>. Сразу откроется редактор где можно
            дорабатывать позиции, менять скидку и проводить переходы по статусам.
          </p>
        </HelpStep>
      </HelpSection>

      <HelpSection title="Жизненный цикл (статусы)">
        <p>
          Каждое КП проходит через строгий конечный автомат — в интерфейсе показываются только
          разрешённые следующие шаги.
        </p>
        <dl className="rounded-md border p-3">
          <HelpDef term="draft">
            Черновик, ещё не отправлен. Дальше: <em>sent</em> или <em>expired</em>.
          </HelpDef>
          <HelpDef term="sent">
            Вы отправили клиенту (письмом, PDF, ссылкой). Дальше: <em>viewed</em>,{" "}
            <em>rejected</em> или <em>expired</em>.
          </HelpDef>
          <HelpDef term="viewed">
            Клиент открыл. Дальше: <em>accepted</em>, <em>rejected</em> или <em>expired</em>.
          </HelpDef>
          <HelpDef term="accepted">Клиент подписал. Терминальное состояние — нельзя редактировать, только удалить.</HelpDef>
          <HelpDef term="rejected">
            Клиент отказался. <em>Причина обязательна</em> (см. блок про безопасность). Терминально.
          </HelpDef>
          <HelpDef term="expired">
            Срок <strong>Valid until</strong> истёк до принятия. Терминально.
          </HelpDef>
        </dl>
      </HelpSection>

      <HelpSection title="Математика: как считаются итоги">
        <p>
          Сумма пересчитывается на сервере при каждом сохранении — невозможно случайно
          рассинхронизировать строки и панель «Summary» справа.
        </p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>По каждой строке: <code>qty × unitPrice − lineDiscountAmount = lineTotal</code></li>
          <li>Subtotal: сумма всех <code>lineTotal</code></li>
          <li>
            Итог: <code>subtotal − discountAmount</code> <em>или</em>{" "}
            <code>subtotal × (1 − discountPct / 100)</code>, никогда оба варианта одновременно
          </li>
          <li>Любое значение &lt; 0 округляется до 0. Все денежные значения хранятся с 4 знаками после запятой.</li>
        </ol>
      </HelpSection>

      <HelpSection title="Причина отказа">
        <HelpCallout kind="security" label="Безопасность">
          <p>
            При переводе КП в статус <strong>rejected</strong> поле «причина отказа»{" "}
            <strong>обязательно</strong>. Текст шифруется в БД ключом, привязанным к вашей
            организации <em>и</em> конкретной колонке — даже с полным доступом к дампу базы
            прочитать значение нельзя без знания что оно из{" "}
            <code>quotes.rejected_reason</code>.
          </p>
          <p className="mt-2">
            Это сделано специально: причины отказа часто содержат коммерчески чувствительные
            детали (бюджетный цикл клиента, внутренний блокер, имя конкурента), которые не должны
            запрашиваться запросом в базу каждым оператором.
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Правила редактирования">
        <HelpCallout kind="warning" label="Внимание">
          <p>
            Как только КП достигает терминального статуса (<em>accepted</em>, <em>rejected</em>,{" "}
            <em>expired</em>) — оно блокируется: строки, скидки, заметки и срок действия становятся
            read-only, кнопка <strong>Save</strong> неактивна.
          </p>
          <p className="mt-2">
            Чтобы пересмотреть принятое/отвергнутое КП — создаётся новое (счётчик{" "}
            <em>version</em> позволит в будущем сгруппировать их под одним номером в режиме
            «пересмотра»).
          </p>
        </HelpCallout>
      </HelpSection>

      <HelpSection title="Что дальше">
        <HelpCallout kind="next" label="Следующие шаги">
          <p>
            Builder UI — первый кусок CPQ. В работе:
          </p>
          <ul className="list-disc pl-5 mt-2 space-y-0.5">
            <li><strong>PDF-рендер</strong> — скачивание брендированного PDF одной кнопкой.</li>
            <li><strong>Email-трекинг</strong> — авто-переход <em>sent</em> → <em>viewed</em> когда клиент открыл письмо.</li>
            <li><strong>Авто-контракт</strong> — при принятии КП создаётся черновик контракта с уже заполненными суммами.</li>
          </ul>
        </HelpCallout>
      </HelpSection>
    </div>
  )
}
